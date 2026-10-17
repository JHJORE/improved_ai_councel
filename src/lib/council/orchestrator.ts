import type {
  Candidate,
  CouncilConfig,
  CouncilRun,
  Job,
  ModelCall,
  Stage,
  Step,
} from '@/lib/council/types'
import { validateConfig } from '@/lib/council/config'
import { anonymize, remapReferences } from '@/lib/council/anonymize'
import { aggregateRanking, parseEvaluation } from '@/lib/council/ranking'
import {
  anonymousPrompt,
  buildIndependentPrompt,
  buildCritiquePrompt,
  buildRevisionPrompt,
  buildEvaluationPrompt,
  buildSynthesisPrompt,
} from '@/lib/council/prompts'

export function createRun(prompt: string, config: CouncilConfig): CouncilRun {
  validateConfig(config)
  if (!prompt.trim() || prompt.length > 60000)
    throw new Error('Enter a question of 1–60,000 characters.')
  const plan: { stage: Stage; round: number }[] = [
    { stage: 'independent', round: 0 },
  ]
  for (let round = 1; round <= config.revisionRounds; round++)
    plan.push({ stage: 'critique', round }, { stage: 'revision', round })
  plan.push({ stage: 'evaluation', round: 0 }, { stage: 'synthesis', round: 0 })
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    originalPrompt: prompt,
    config: structuredClone(config),
    steps: plan.map((s) => ({ ...s, jobs: [], complete: false })),
    cursor: 0,
    status: 'paused',
    aggregateRanking: [],
    durationMs: 0,
  }
}
export function restoreRun(saved: CouncilRun): CouncilRun {
  const run = structuredClone(saved)
  if (run.status === 'running') run.status = 'paused'
  for (const step of run.steps)
    for (const job of step.jobs)
      if (job.status === 'running') {
        job.status = 'error'
        job.error = 'Interrupted. Retry to regenerate this request.'
      }
  return run
}
export class CouncilOrchestrator {
  run: CouncilRun
  private lastEmission = 0
  private busy = false
  private pauseRequested = false
  private controller = new AbortController()
  private call: ModelCall
  private save: (run: CouncilRun) => Promise<void>
  private changed: (run: CouncilRun) => void
  constructor(
    run: CouncilRun,
    call: ModelCall,
    save: (run: CouncilRun) => Promise<void>,
    changed: (run: CouncilRun) => void,
  ) {
    this.call = call
    this.save = save
    this.changed = changed
    this.run = restoreRun(run)
  }
  private emit(force = true) {
    if (!force && Date.now() - this.lastEmission < 50) return
    this.lastEmission = Date.now()
    this.changed(structuredClone(this.run))
  }
  private async checkpoint() {
    await this.save(structuredClone(this.run))
    this.emit()
  }
  pauseAfterStage() {
    this.pauseRequested = true
  }
  stop() {
    this.pauseRequested = true
    this.controller.abort()
  }
  private candidates(): Candidate[] {
    const prior = this.run.steps
      .slice(0, this.run.cursor)
      .filter((s) => s.stage === 'independent' || s.stage === 'revision')
      .at(-1)
    return (
      prior?.jobs
        .filter((j) => j.status === 'complete')
        .map((j) => ({ id: j.memberId, text: j.text })) ?? []
    )
  }
  private prepare(step: Step) {
    if (step.jobs.length) return
    const { config, originalPrompt: q, steps } = this.run
    const current = this.candidates()
    const preceding = steps[this.run.cursor - 1]
    const members =
      step.stage === 'independent'
        ? config.members
        : config.members.filter(
            (m) =>
              current.some((c) => c.id === m.id) &&
              (preceding?.stage !== 'critique' ||
                preceding.jobs.some(
                  (j) => j.memberId === m.id && j.status === 'complete',
                )),
          )
    if (step.stage !== 'independent') step.anonymous = anonymize(current)
    if (step.stage === 'revision') step.anonymous = preceding.anonymous
    if (step.stage === 'synthesis') step.anonymous = preceding.anonymous
    const responses = step.anonymous?.responses ?? []
    const critiques =
      preceding?.stage === 'critique'
        ? preceding.jobs
            .filter((j) => j.status === 'complete')
            .map((j) => j.text)
        : []
    const models = config.members
      .flatMap((m) => [m.model, m.label])
      .concat(config.chairmanModel)
    const make = (memberId: string, model: string, prompt: string): Job => ({
      memberId,
      model,
      prompt:
        step.stage === 'independent' ? prompt : anonymousPrompt(prompt, models),
      text: '',
      status: 'pending',
      attempts: 0,
    })
    if (step.stage === 'synthesis') {
      step.jobs = [
        make(
          'chairman',
          config.chairmanModel,
          buildSynthesisPrompt(
            q,
            responses,
            preceding.jobs
              .filter((j) => j.status === 'complete')
              .map((j) => j.text),
            this.run.aggregateRanking.map(({ responseId, meanRank }) => ({
              responseId,
              meanRank,
            })),
            steps
              .filter((s) => s.stage === 'critique')
              .flatMap((s) =>
                s.jobs
                  .filter((j) => j.status === 'complete')
                  .map(
                    (j) =>
                      `Earlier draft critique, round ${s.round}:\n${remapReferences(j.text, s.anonymous!.mapping, step.anonymous!.mapping)}`,
                  ),
              ),
          ),
        ),
      ]
    } else
      step.jobs = members.map((m) => {
        let prompt = ''
        switch (step.stage) {
          case 'independent':
            prompt = buildIndependentPrompt(q)
            break
          case 'critique':
            prompt = buildCritiquePrompt(q, responses)
            break
          case 'revision':
            prompt = buildRevisionPrompt(
              q,
              steps[0].jobs.find((j) => j.memberId === m.id)?.text ?? '',
              current.find((c) => c.id === m.id)?.text ?? '',
              responses,
              critiques,
            )
            break
          case 'evaluation':
            prompt = buildEvaluationPrompt(q, responses)
            break
        }
        return make(m.id, m.model, prompt)
      })
  }
  async execute(retryMemberId?: string) {
    if (this.busy || this.run.status === 'complete') return
    this.busy = true
    this.pauseRequested = false
    this.controller = new AbortController()
    const started = Date.now()
    this.run.status = 'running'
    this.run.error = undefined
    try {
      while (this.run.cursor < this.run.steps.length) {
        const step = this.run.steps[this.run.cursor]
        this.prepare(step)
        await this.checkpoint()
        const jobs = step.jobs.filter(
          (j) =>
            j.status === 'pending' ||
            (j.status === 'error' &&
              (!retryMemberId || j.memberId === retryMemberId)),
        )
        const results = await Promise.allSettled(
          jobs.map(async (j) => {
            j.status = 'running'
            j.error = undefined
            j.text = ''
            j.usage = undefined
            j.evaluation = undefined
            j.attempts++
            this.emit()
            const start = Date.now()
            try {
              const result = await this.call({
                model: j.model,
                prompt: j.prompt,
                evaluationIds:
                  step.stage === 'evaluation'
                    ? step.anonymous!.responses.map((c) => c.id)
                    : undefined,
                signal: this.controller.signal,
                onText: (text) => {
                  j.text = text
                  this.emit(false)
                },
              })
              j.text = result.text
              j.usage = result.usage
              if (!j.text.trim())
                throw new Error(
                  'The model returned no answer. Retry this request.',
                )
              if (step.stage === 'evaluation')
                j.evaluation = parseEvaluation(
                  j.text,
                  step.anonymous!.responses.map((c) => c.id),
                )
              j.status = 'complete'
            } catch (e) {
              j.status = 'error'
              j.error = this.controller.signal.aborted
                ? 'Stopped. Retry this request to resume.'
                : e instanceof Error
                  ? e.message
                  : 'Request failed.'
            }
            j.durationMs = Date.now() - start
            j.history ??= []
            j.history.push({
              text: j.text,
              status: j.status,
              usage: j.usage,
              durationMs: j.durationMs,
              error: j.error,
            })
            // Persist each successful/failed request so a refresh retains its peers.
            await this.checkpoint()
          }),
        )
        if (results.some((r) => r.status === 'rejected'))
          throw new Error('Storage failed')
        retryMemberId = undefined
        if (step.jobs.some((j) => j.status === 'error')) {
          this.run.status = this.controller.signal.aborted ? 'paused' : 'error'
          break
        }
        if (step.stage === 'evaluation')
          this.run.aggregateRanking = aggregateRanking(
            step.jobs.flatMap((j) => (j.evaluation ? [j.evaluation] : [])),
            step.anonymous!.mapping,
          )
        step.complete = true
        this.run.cursor++
        await this.checkpoint()
        if (this.pauseRequested) {
          this.run.status = 'paused'
          break
        }
      }
      if (this.run.cursor === this.run.steps.length)
        this.run.status = 'complete'
    } catch {
      this.run.status = 'error'
      this.run.error =
        'Could not save or advance this run. Check browser storage and retry.'
    } finally {
      this.run.durationMs += Date.now() - started
      this.busy = false
      try {
        await this.checkpoint()
      } catch {
        this.run.status = 'error'
        this.run.error =
          'Local storage failed. Keep this page open and export the run.'
        this.emit()
      }
    }
  }
  async continueWithSuccessful() {
    if (this.busy) return
    const step = this.run.steps[this.run.cursor]
    if (
      !step ||
      step.stage === 'synthesis' ||
      step.jobs.filter((j) => j.status === 'complete').length < 2
    )
      return
    for (const j of step.jobs) if (j.status === 'error') j.status = 'skipped'
    await this.execute()
  }
}
