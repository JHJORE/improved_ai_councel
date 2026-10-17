import 'fake-indexeddb/auto'
import {
  anonymize,
  redactIdentity,
  remapReferences,
} from '@/lib/council/anonymize'
import { parseEvaluation, aggregateRanking } from '@/lib/council/ranking'
import {
  buildSynthesisPrompt,
  buildIndependentPrompt,
  MAX_SECTION_CHARS,
} from '@/lib/council/prompts'
import {
  createRun,
  CouncilOrchestrator,
  restoreRun,
} from '@/lib/council/orchestrator'
import { DEFAULT_COUNCIL_CONFIG, callCount } from '@/lib/council/config'
import {
  saveRun,
  loadRuns,
  saveConfig,
  loadConfig,
} from '@/lib/council/persistence'
import { clearAllTables, deleteDatabase } from '@/test/db-helpers'
import type { ModelCall } from '@/lib/council/types'
const candidates = [
  { id: 'claude', text: 'First' },
  { id: 'gpt', text: 'Second' },
  { id: 'gemini', text: 'Third' },
]
export const evaluation = (ids = ['A', 'B', 'C']) => ({
  evaluations: ids.map((responseId) => ({
    responseId,
    accuracy: 8,
    completeness: 9,
    reasoning: 7,
    usefulness: 8,
    flaws: ['A remaining uncertainty'],
  })),
  ranking: [...ids].reverse(),
})
const successful: ModelCall = async ({ evaluationIds, onText }) => {
  const text = evaluationIds
    ? JSON.stringify(evaluation(evaluationIds))
    : 'A considered answer.'
  onText(text)
  return { text, usage: { input: 100, output: 50, cost: 0.01 } }
}
const config = () => structuredClone(DEFAULT_COUNCIL_CONFIG)
function engine(call: ModelCall = successful, rounds = 1) {
  return new CouncilOrchestrator(
    createRun('What is the best approach?', {
      ...config(),
      revisionRounds: rounds,
    }),
    call,
    async () => {},
    () => {},
  )
}
describe('anonymous labels', () => {
  it('preserves every response and a reversible map without mutating inputs', () => {
    const result = anonymize(candidates, () => 0)
    expect(result.mapping).toEqual({ A: 'gpt', B: 'gemini', C: 'claude' })
    for (const c of result.responses)
      expect(c.text).toBe(
        candidates.find((x) => x.id === result.mapping[c.id])?.text,
      )
    expect(candidates[0].id).toBe('claude')
    expect(JSON.stringify(result.responses)).not.toMatch(/claude|gemini|gpt/)
  })
  it('can generate all six permutations', () => {
    const maps = new Set<string>()
    for (const a of [0, 0.4, 0.9])
      for (const b of [0, 0.9]) {
        const values = [a, b]
        maps.add(
          JSON.stringify(anonymize(candidates, () => values.shift()!).mapping),
        )
      }
    expect(maps.size).toBe(6)
  })
  it('redacts self-identification and configured IDs', () =>
    expect(
      redactIdentity(
        'I am Claude from Anthropic, unlike GPT-5.4 and Gemini. foo/private-model',
        ['foo/private-model'],
      ),
    ).not.toMatch(/Claude|Anthropic|GPT|Gemini|foo/))
})
describe('rankings', () => {
  it('accepts fenced JSON, validates and averages ordinal ranks', () => {
    const e = parseEvaluation(
      '```json\n' + JSON.stringify(evaluation()) + '\n```',
      ['A', 'B', 'C'],
    )
    expect(e.ranking).toEqual(['C', 'B', 'A'])
    expect(
      aggregateRanking([e, { ...e, ranking: ['A', 'C', 'B'] }], {
        A: 'one',
        B: 'two',
        C: 'three',
      }),
    ).toEqual([
      { responseId: 'C', memberId: 'three', meanRank: 1.5 },
      { responseId: 'A', memberId: 'one', meanRank: 2 },
      { responseId: 'B', memberId: 'two', meanRank: 2.5 },
    ])
  })
  it.each([
    { ...evaluation(), ranking: ['A', 'A', 'B'] },
    { ...evaluation(), ranking: ['A', 'B', 'Z'] },
    { ...evaluation(), evaluations: [] },
    {
      ...evaluation(),
      evaluations: evaluation().evaluations.map((e) => ({
        ...e,
        accuracy: 11,
      })),
    },
  ])('rejects malformed evaluations', (value) =>
    expect(() =>
      parseEvaluation(JSON.stringify(value), ['A', 'B', 'C']),
    ).toThrow(),
  )
  it('accepts explicit prose scores and ranking but never fabricates missing scores', () => {
    const prose =
      ['A', 'B', 'C']
        .map(
          (id) =>
            `Response ${id}\nAccuracy: 9\nCompleteness: 8\nReasoning quality: 7\nUsefulness/actionability: 6\nFlaws: uncertainty`,
        )
        .join('\n') +
      '\nFINAL RANKING:\n1. Response B\n2. Response A\n3. Response C'
    expect(parseEvaluation(prose, ['A', 'B', 'C']).ranking).toEqual([
      'B',
      'A',
      'C',
    ])
    expect(() =>
      parseEvaluation(
        'FINAL RANKING:\n1. Response A\n2. Response B\n3. Response C',
        ['A', 'B', 'C'],
      ),
    ).toThrow()
  })
})
describe('pipeline', () => {
  it.each([0, 1, 2, 3])(
    'runs configured rounds %i with stage barriers and independent initial context',
    async (rounds) => {
      const call = vi.fn(successful),
        e = engine(call, rounds)
      await e.execute()
      expect(e.run.status).toBe('complete')
      expect(call).toHaveBeenCalledTimes(callCount(rounds))
      expect(e.run.steps.every((s) => s.complete)).toBe(true)
      expect(e.run.steps.filter((s) => s.stage === 'revision')).toHaveLength(
        rounds,
      )
      for (const job of e.run.steps[0].jobs) {
        expect(job.prompt).not.toContain('CANDIDATE RESPONSES')
        expect(job.prompt).not.toContain('considered answer')
      }
      for (const step of e.run.steps.slice(1))
        for (const job of step.jobs)
          expect(job.prompt).not.toMatch(
            /anthropic|openai|google|Claude|GPT|Gemini/,
          )
      expect(e.run.aggregateRanking).toHaveLength(3)
    },
  )
  it.each([-1, 4, 0.5])('rejects invalid revision count %i', (n) =>
    expect(() => createRun('q', { ...config(), revisionRounds: n })).toThrow(),
  )
  it('starts all peers concurrently, waits for every peer before critique', async () => {
    const releases: (() => void)[] = []
    const call = vi.fn<ModelCall>(async (r) => {
      if (!r.prompt.includes('CANDIDATE RESPONSES'))
        await new Promise<void>((resolve) => releases.push(resolve))
      return successful(r)
    })
    const e = engine(call)
    const pending = e.execute()
    await vi.waitFor(() => expect(releases).toHaveLength(3))
    releases[0]()
    releases[1]()
    await new Promise((r) => setTimeout(r, 0))
    expect(call).toHaveBeenCalledTimes(3)
    releases[2]()
    await pending
    expect(e.run.status).toBe('complete')
  })
  it('preserves successes, retries only a failed provider', async () => {
    let fail = true
    const call = vi.fn<ModelCall>(async (r) => {
      if (fail && r.model.startsWith('openai')) throw new Error('Unavailable')
      return successful(r)
    })
    const e = engine(call)
    await e.execute()
    expect(e.run.status).toBe('error')
    expect(e.run.cursor).toBe(0)
    expect(
      e.run.steps[0].jobs.filter((j) => j.status === 'complete'),
    ).toHaveLength(2)
    fail = false
    await e.execute('gpt')
    expect(e.run.status).toBe('complete')
    expect(call).toHaveBeenCalledTimes(14)
    expect(e.run.steps[0].jobs.map((j) => j.attempts)).toEqual([1, 2, 1])
  })
  it('allows explicit degradation to two without rerunning failed requests', async () => {
    const call = vi.fn<ModelCall>(async (r) => {
      if (r.model.startsWith('openai')) throw new Error('Unavailable')
      return successful(r)
    })
    const e = engine(call)
    await e.execute()
    await e.continueWithSuccessful()
    expect(e.run.status).toBe('complete')
    expect(e.run.steps[0].jobs[1].status).toBe('skipped')
    expect(e.run.aggregateRanking).toHaveLength(2)
    expect(
      call.mock.calls.filter(([r]) => r.model.startsWith('openai')),
    ).toHaveLength(1)
  })
  it('refuses to continue with only one answer', async () => {
    const e = engine(async (r) => {
      if (!r.model.startsWith('anthropic')) throw new Error('Unavailable')
      return successful(r)
    })
    await e.execute()
    await e.continueWithSuccessful()
    expect(e.run.cursor).toBe(0)
    expect(e.run.status).toBe('error')
  })
  it('pauses at a stage boundary and resumes without repeating answers', async () => {
    const e = engine(async (r) => {
      e.pauseAfterStage()
      return successful(r)
    })
    await e.execute()
    expect(e.run.cursor).toBe(1)
    expect(e.run.status).toBe('paused')
    const resumed = new CouncilOrchestrator(
      e.run,
      successful,
      async () => {},
      () => {},
    )
    await resumed.execute()
    expect(resumed.run.status).toBe('complete')
    expect(resumed.run.steps[0].jobs.every((j) => j.attempts === 1)).toBe(true)
  })
  it('aborts active calls and restores interrupted requests', async () => {
    const e = engine(
      async (r) =>
        new Promise((_, reject) =>
          r.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    )
    const pending = e.execute()
    await vi.waitFor(() =>
      expect(
        e.run.steps[0].jobs.filter((j) => j.status === 'running'),
      ).toHaveLength(3),
    )
    e.stop()
    await pending
    expect(e.run.status).toBe('paused')
    expect(e.run.steps[0].jobs.every((j) => j.status === 'error')).toBe(true)
    const saved = structuredClone(e.run)
    saved.status = 'running'
    saved.steps[0].jobs[0].status = 'running'
    expect(restoreRun(saved).steps[0].jobs[0].status).toBe('error')
  })
  it('keeps malformed judge output and prevents synthesis until corrected', async () => {
    const e = engine(async (r) =>
      r.evaluationIds ? { text: 'not a ranking' } : successful(r),
    )
    await e.execute()
    expect(e.run.status).toBe('error')
    expect(e.run.steps[e.run.cursor].stage).toBe('evaluation')
    expect(e.run.steps.at(-1)?.jobs).toHaveLength(0)
    expect(e.run.steps[e.run.cursor].jobs[0].text).toBe('not a ranking')
  })
})
describe('prompts and persistence', () => {
  beforeEach(clearAllTables)
  afterAll(deleteDatabase)
  it('makes the chairman preserve disagreements, avoid copying and avoid unsupported reconciliation', () => {
    const p = buildSynthesisPrompt(
      'question',
      [{ id: 'A', text: 'candidate' }],
      ['evaluation'],
      [{ responseId: 'A', meanRank: 1 }],
      ['minority view'],
    )
    for (const section of [
      'ORIGINAL QUESTION',
      'CANDIDATE RESPONSES',
      'EVALUATIONS',
      'AGGREGATE RANKINGS',
      'minority view',
      'Do NOT simply copy',
      'unsupported claims',
      'correctness and usefulness',
    ])
      expect(p).toContain(section)
  })
  it('marks large context truncation explicitly', () =>
    expect(buildIndependentPrompt('x'.repeat(MAX_SECTION_CHARS + 1))).toContain(
      '[TRUNCATED',
    ))
  it('persists/restores completed run and configuration without secrets', async () => {
    const e = engine()
    await e.execute()
    await saveRun(e.run)
    expect(await loadRuns()).toEqual([e.run])
    expect(JSON.stringify((await loadRuns())[0])).not.toContain('apiKey')
    const c = { ...config(), revisionRounds: 3 }
    await saveConfig(c)
    expect(await loadConfig()).toEqual(c)
  })
})

it('translates earlier critique references into the final mapping', () => {
  expect(
    remapReferences(
      'Response A challenges Response B and Response C.',
      { A: 'first', B: 'second', C: 'third' },
      { A: 'second', B: 'first' },
    ),
  ).toBe(
    'Response B challenges Response A and [earlier candidate excluded from final evaluation].',
  )
})
it('preserves reported usage and raw text from failed evaluation attempts', async () => {
  let bad = true
  const e = engine(async (r) =>
    r.evaluationIds && bad
      ? { text: 'malformed', usage: { input: 1, output: 2, cost: 0.3 } }
      : successful(r),
  )
  await e.execute()
  bad = false
  await e.execute()
  const job = e.run.steps.find((s) => s.stage === 'evaluation')!.jobs[0]
  expect(job.history).toHaveLength(2)
  expect(job.history![0].text).toBe('malformed')
  expect(
    job.history!.reduce((s, a) => s + (a.usage?.cost ?? 0), 0),
  ).toBeCloseTo(0.31)
})
