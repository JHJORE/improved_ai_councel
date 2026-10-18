import { useEffect, useRef, useState } from 'react'
import { SafeMarkdown } from '@/components/SafeMarkdown'
import { Button } from '@/components/ui/button'
import { getSettings } from '@/lib/db'
import {
  CouncilOrchestrator,
  createRun,
  restoreRun,
} from '@/lib/council/orchestrator'
import { loadConfig, loadRuns, saveRun } from '@/lib/council/persistence'
import { createModelCall, loadCatalog } from '@/lib/council/transport'
import type { CatalogModel } from '@/lib/council/transport'
import type { CouncilRun, Job, Step, Usage } from '@/lib/council/types'

function Answer({ text }: { text: string }) {
  return (
    <div className="markdown-prose max-w-none text-sm leading-relaxed break-words">
      <SafeMarkdown>{text}</SafeMarkdown>
    </div>
  )
}
function Columns({ step, run }: { step: Step; run: CouncilRun }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {step.jobs.map((j) => (
        <article
          key={j.memberId}
          className="bg-card min-w-0 rounded-lg border p-4"
        >
          <h3 className="mb-3 font-semibold">
            {run.config.members.find((m) => m.id === j.memberId)?.label ??
              'Chairman'}{' '}
            {step.stage === 'revision' ? `R${step.round + 1}` : ''}
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {j.status}
            </span>
          </h3>
          {j.error && (
            <p role="alert" className="text-destructive mb-2">
              {j.error}
            </p>
          )}
          <Answer text={j.text || 'Waiting…'} />
        </article>
      ))}
    </div>
  )
}
function UsageTable({
  jobs,
  group,
}: {
  jobs: Job[]
  group: (j: Job) => string
}) {
  const rows = new Map<
    string,
    { tokens: number; cost: number; unknown: boolean }
  >()
  for (const job of jobs) {
    const key = group(job),
      row = rows.get(key) ?? { tokens: 0, cost: 0, unknown: false }
    const attempts = job.history?.length ? job.history : [job]
    for (const attempt of attempts) {
      row.tokens += (attempt.usage?.input ?? 0) + (attempt.usage?.output ?? 0)
      row.cost += attempt.usage?.cost ?? 0
      row.unknown ||= attempt.usage?.cost == null
    }
    rows.set(key, row)
  }
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr>
          <th className="py-2">Group</th>
          <th>Tokens</th>
          <th>Cost (USD)</th>
        </tr>
      </thead>
      <tbody>
        {[...rows].map(([name, row]) => (
          <tr key={name}>
            <td className="py-1 break-all">{name}</td>
            <td>{row.tokens.toLocaleString()}</td>
            <td>
              ${row.cost.toFixed(4)}
              {row.unknown ? ' + unknown' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
export function CouncilPanel({
  onBusyChange,
  startEmpty = false,
}: {
  startEmpty?: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [prompt, setPrompt] = useState('')
  const [run, setRun] = useState<CouncilRun | null>(null)
  const [history, setHistory] = useState<CouncilRun[]>([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [pauseQueued, setPauseQueued] = useState(false)
  const engine = useRef<CouncilOrchestrator | null>(null)
  const busy = starting || run?.status === 'running'
  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])
  useEffect(() => {
    let active = true
    loadRuns()
      .then((r) => {
        if (active) {
          setHistory(r)
          if (r[0] && !startEmpty) setRun(restoreRun(r[0]))
          setReady(true)
        }
      })
      .catch(() => {
        if (active) setError('Could not load local Council storage.')
      })
    return () => {
      active = false
      engine.current?.stop()
    }
  }, [startEmpty])
  const update = (r: CouncilRun) => {
    setRun(r)
    if (r.status !== 'running')
      setHistory((h) => [r, ...h.filter((x) => x.id !== r.id)])
  }
  async function getEngine(target: CouncilRun) {
    const settings = await getSettings()
    const isBedrock = target.config.backend === 'bedrock'
    const apiKey = isBedrock
      ? settings.apiKeys.bedrock
      : settings.apiKeys.openrouter
    if (!apiKey?.trim())
      throw new Error(
        `Enter your ${isBedrock ? 'AWS Bedrock' : 'OpenRouter'} API key in Settings first.`,
      )
    const models = isBedrock
      ? []
      : catalog.length
        ? catalog
        : await loadCatalog()
    if (!isBedrock) {
      if (!catalog.length) setCatalog(models)
      for (const id of [
        ...target.config.members.map((m) => m.model),
        target.config.chairmanModel,
      ])
        if (!models.some((m) => m.id === id))
          throw new Error(
            `Model ${id} is unavailable. Select an available model in Settings.`,
          )
    }
    const instance = new CouncilOrchestrator(
      target,
      createModelCall(
        apiKey,
        models,
        isBedrock ? { region: target.config.region! } : undefined,
      ),
      saveRun,
      update,
    )
    engine.current = instance
    return instance
  }
  async function execute(
    action: 'new' | 'resume' | 'continue',
    memberId?: string,
  ) {
    if (busy) return
    setStarting(true)
    setError('')
    setPauseQueued(false)
    try {
      const target =
        action === 'new' ? createRun(prompt, await loadConfig()) : run
      if (
        target &&
        action === 'new' &&
        run?.status === 'complete' &&
        final?.text
      ) {
        target.conversationContext = [
          ...(run.conversationContext ?? []),
          { question: run.originalPrompt, answer: final.text },
        ]
      }
      if (!target) return
      const instance = await getEngine(target)
      if (action === 'new') {
        await saveRun(target)
        setRun(target)
        setPrompt('')
      }
      if (action === 'continue') await instance.continueWithSuccessful()
      else await instance.execute(memberId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Council.')
    } finally {
      setStarting(false)
    }
  }
  const current = run?.steps[run.cursor]
  const jobs = run?.steps.flatMap((s) => s.jobs) ?? []
  const attempts = jobs.flatMap<{ usage?: Usage }>((j) =>
    j.history?.length ? j.history : [j],
  )
  const cost = attempts.reduce((s, j) => s + (j.usage?.cost ?? 0), 0)
  const final = run?.steps.find((s) => s.stage === 'synthesis')?.jobs[0]
  const displayStep = current?.jobs.length
    ? current
    : run?.steps.slice(0, run.cursor).at(-1)
  return (
    <section
      aria-label="Council workspace"
      className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Chat</h1>
            <p className="text-muted-foreground text-sm">
              Ask a question. Get one considered answer.
            </p>
          </div>
          <label className="text-sm">
            Chat history{' '}
            <select
              aria-label="Saved council runs"
              className="bg-background ml-2 max-w-64 rounded border p-2"
              disabled={busy}
              value={run?.id ?? ''}
              onChange={(e) => {
                const r = history.find((x) => x.id === e.target.value)
                if (!e.target.value) {
                  setRun(null)
                  engine.current = null
                }
                if (r) {
                  setRun(restoreRun(r))
                  engine.current = null
                }
              }}
            >
              <option value="">New chat</option>
              {history.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.originalPrompt.slice(0, 65)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p role="status" className="text-sm">
            {error}
          </p>
        )}
        {run?.conversationContext?.map((turn, i) => (
          <div key={i} className="flex flex-col gap-3">
            <p className="bg-muted self-end rounded-lg p-3 text-sm">
              {turn.question}
            </p>
            <article className="rounded-lg border p-4">
              <Answer text={turn.answer} />
            </article>
          </div>
        ))}
        {run && (
          <>
            <p className="bg-muted self-end rounded-lg p-3 text-sm">
              {run.originalPrompt}
            </p>
            {busy && (
              <p role="status" className="text-muted-foreground text-sm">
                Thinking — comparing answers automatically…
              </p>
            )}
            <details
              open={run.status === 'error' || run.status === 'paused'}
              className="rounded-lg border p-4"
            >
              <summary className="cursor-pointer text-sm">
                Council progress and controls
              </summary>

              <ol
                aria-label="Council progress"
                className="flex flex-wrap gap-3 text-sm"
              >
                {run.steps.map((s, i) => (
                  <li
                    key={i}
                    aria-current={i === run.cursor ? 'step' : undefined}
                    className={
                      i === run.cursor
                        ? 'text-primary font-semibold'
                        : 'text-muted-foreground'
                    }
                  >
                    {s.complete ? '✓ ' : i === run.cursor ? '→ ' : ''}
                    {s.stage[0].toUpperCase() + s.stage.slice(1)}
                    {s.round ? ` ${s.round}` : ''}
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span role="status" className="text-sm">
                  {run.status}
                </span>
                {busy ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        engine.current?.pauseAfterStage()
                        setPauseQueued(true)
                      }}
                    >
                      {pauseQueued ? 'Pause queued' : 'Pause after stage'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => engine.current?.stop()}
                    >
                      Stop now
                    </Button>
                  </>
                ) : (
                  run.status !== 'complete' && (
                    <>
                      <Button size="sm" onClick={() => void execute('resume')}>
                        Resume / retry failed
                      </Button>
                      {(current?.jobs.filter((j) => j.status === 'complete')
                        .length ?? 0) >= 2 &&
                        current?.jobs.some((j) => j.status === 'error') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void execute('continue')}
                          >
                            Continue with successful models
                          </Button>
                        )}
                    </>
                  )
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const { downloadJson } = await import('@/lib/download')
                    downloadJson(
                      JSON.stringify(run, null, 2),
                      `council-${run.id}.json`,
                    )
                  }}
                >
                  Export run
                </Button>
              </div>
              {run.error && <p role="alert">{run.error}</p>}
              {!busy &&
                current?.jobs
                  .filter((j) => j.status === 'error')
                  .map((j) => (
                    <div key={j.memberId} className="mt-3 text-sm">
                      <p>
                        {j.model}: {j.error}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void execute('resume', j.memberId)}
                      >
                        Retry{' '}
                        {run.config.members.find((m) => m.id === j.memberId)
                          ?.label ?? 'Chairman'}{' '}
                        only
                      </Button>
                    </div>
                  ))}
            </details>
            {final?.text && (
              <article className="bg-card rounded-xl border p-5">
                <h2 className="mb-4 text-lg font-semibold">Final answer</h2>
                <Answer text={final.text} />
              </article>
            )}
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm">
                Inspect answers, rankings and usage
              </summary>
              {busy && displayStep && displayStep.stage !== 'synthesis' && (
                <details>
                  <summary className="cursor-pointer text-sm">
                    Live model answers
                  </summary>
                  <Columns step={displayStep} run={run} />
                </details>
              )}
              {(
                ['revision', 'evaluation', 'critique', 'independent'] as const
              ).map((stage) => {
                const steps = run.steps.filter(
                  (s) => s.stage === stage && s.jobs.length,
                )
                return (
                  steps.length > 0 && (
                    <details key={stage} className="rounded-lg border p-4">
                      <summary className="cursor-pointer font-medium">
                        {
                          {
                            revision: 'Revised answers',
                            evaluation: 'Rankings',
                            critique: 'Critiques',
                            independent: 'Initial answers',
                          }[stage]
                        }
                      </summary>
                      <div className="mt-4 flex flex-col gap-4">
                        {stage === 'evaluation' &&
                          run.aggregateRanking.length > 0 && (
                            <ol>
                              {run.aggregateRanking.map((r) => (
                                <li key={r.responseId}>
                                  Response {r.responseId} ·{' '}
                                  {
                                    run.config.members.find(
                                      (m) => m.id === r.memberId,
                                    )?.label
                                  }{' '}
                                  · mean rank {r.meanRank.toFixed(2)}
                                </li>
                              ))}
                            </ol>
                          )}
                        {steps.map((s, i) => (
                          <div key={i}>
                            {s.round > 0 && (
                              <h3 className="mb-2 text-sm">Round {s.round}</h3>
                            )}
                            <Columns step={s} run={run} />
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                )
              })}
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">
                  Usage · ${cost.toFixed(4)}
                  {attempts.some((j) => j.usage?.cost == null)
                    ? ' + unknown'
                    : ''}{' '}
                  · {(run.durationMs / 1000).toFixed(1)}s active time
                </summary>
                <p className="text-muted-foreground my-3 text-xs">
                  Reported usage where available; otherwise catalog pricing
                  estimates. Interrupted calls may incur additional charges not
                  reported here. OpenRouter billing is authoritative.
                </p>
                <UsageTable jobs={jobs} group={(j) => j.model} />
                <UsageTable
                  jobs={jobs}
                  group={(j) => {
                    const s = run.steps.find((s) => s.jobs.includes(j))!
                    return `${s.stage} ${s.round || ''}`
                  }}
                />
              </details>
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">
                  Raw execution details
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto text-xs break-all whitespace-pre-wrap">
                  {JSON.stringify(run, null, 2)}
                </pre>
              </details>
            </details>
          </>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void execute('new')
          }}
          className="bg-background sticky bottom-0 flex flex-col gap-3 border-t py-3"
        >
          <label htmlFor="council-question" className="font-medium">
            Message
          </label>
          <textarea
            id="council-question"
            className="bg-background min-h-24 rounded-lg border p-3 text-sm"
            placeholder="Ask anything…"
            maxLength={60000}
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                if (prompt.trim() && !busy && ready) void execute('new')
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !ready || !prompt.trim()}>
              Send
            </Button>
            <span className="text-muted-foreground text-xs">
              Automatic council · model options in Settings
            </span>
          </div>
        </form>
      </div>
    </section>
  )
}
