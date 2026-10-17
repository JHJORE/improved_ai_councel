import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getSettings } from '@/lib/db'
import {
  CouncilOrchestrator,
  createRun,
  restoreRun,
} from '@/lib/council/orchestrator'
import { DEFAULT_COUNCIL_CONFIG, callCount } from '@/lib/council/config'
import {
  loadConfig,
  loadRuns,
  saveConfig,
  saveRun,
} from '@/lib/council/persistence'
import { createModelCall, loadCatalog } from '@/lib/council/transport'
import type { CatalogModel } from '@/lib/council/transport'
import type { CouncilRun, Job, Step, Usage } from '@/lib/council/types'
import { downloadJson } from '@/lib/download'

function Answer({ text }: { text: string }) {
  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
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
}: {
  onBusyChange: (busy: boolean) => void
}) {
  const [config, setConfig] = useState(() =>
    structuredClone(DEFAULT_COUNCIL_CONFIG),
  )
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
    Promise.all([loadConfig(), loadRuns()])
      .then(([c, r]) => {
        if (active) {
          setConfig(c)
          setHistory(r)
          if (r[0]) setRun(restoreRun(r[0]))
          setReady(true)
        }
      })
      .catch(() => {
        if (active) setError('Could not load local Council storage.')
      })
    loadCatalog()
      .then((c) => {
        if (active) setCatalog(c)
      })
      .catch(() => {
        if (active)
          setError('Model catalog unavailable. Reload models before starting.')
      })
    return () => {
      active = false
      engine.current?.stop()
    }
  }, [])
  const update = (r: CouncilRun) => {
    setRun(r)
    if (r.status !== 'running')
      setHistory((h) => [r, ...h.filter((x) => x.id !== r.id)])
  }
  async function getEngine(target: CouncilRun) {
    const settings = await getSettings()
    if (!settings.apiKeys.openrouter.trim())
      throw new Error(
        'Enter your OpenRouter API key in Settings (gear icon) first.',
      )
    const models = catalog.length ? catalog : await loadCatalog()
    if (!catalog.length) setCatalog(models)
    for (const id of [
      ...target.config.members.map((m) => m.model),
      target.config.chairmanModel,
    ])
      if (!models.some((m) => m.id === id))
        throw new Error(
          `Model ${id} is not in the current OpenRouter catalog. Select an available model.`,
        )
    const instance = new CouncilOrchestrator(
      target,
      createModelCall(settings.apiKeys.openrouter, models),
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
      const target = action === 'new' ? createRun(prompt, config) : run
      if (!target) return
      const instance = await getEngine(target)
      if (action === 'new') {
        await saveConfig(config)
        await saveRun(target)
        setRun(target)
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
            <h1 className="text-xl font-semibold">Council</h1>
            <p className="text-muted-foreground text-sm">
              Independent perspectives. Critical review. One considered answer.
            </p>
          </div>
          <label className="text-sm">
            Saved runs{' '}
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
              <option value="">New run</option>
              {history.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.originalPrompt.slice(0, 65)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Council settings · {config.revisionRounds} revision round(s) ·{' '}
            {callCount(config.revisionRounds)} planned calls
          </summary>
          <fieldset disabled={busy} className="mt-4 grid gap-3 md:grid-cols-2">
            {config.members.map((member, i) => (
              <label key={member.id} className="text-sm">
                {member.label} model
                <Input
                  list={`council-models-${member.id}`}
                  aria-label={`${member.label} council model`}
                  value={member.model}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      members: c.members.map((m, n) =>
                        n === i ? { ...m, model: e.target.value } : m,
                      ),
                    }))
                  }
                />
                <datalist id={`council-models-${member.id}`}>
                  {catalog
                    .filter((m) => m.id.startsWith(member.provider + '/'))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </datalist>
              </label>
            ))}
            <label className="text-sm">
              Chairman model
              <Input
                aria-label="Chairman model"
                list="chairman-models"
                value={config.chairmanModel}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, chairmanModel: e.target.value }))
                }
              />
              <datalist id="chairman-models">
                {catalog.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="text-sm">
              Revision rounds{' '}
              <select
                aria-label="Revision rounds"
                className="bg-background ml-2 rounded border p-2"
                value={config.revisionRounds}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    revisionRounds: Number(e.target.value),
                  }))
                }
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void saveConfig(config)
                    .then(() => setError('Settings saved.'))
                    .catch(() => setError('Could not save settings.'))
                }
              >
                Save settings
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void loadCatalog()
                    .then((c) => {
                      setCatalog(c)
                      setError('Models refreshed.')
                    })
                    .catch(() => setError('Could not load models.'))
                }
              >
                Reload models
              </Button>
            </div>
          </fieldset>
          <p className="text-muted-foreground mt-3 text-xs">
            Select a catalog suggestion or enter an exact OpenRouter ID.
            Chairman can be any available model. Settings apply to new runs;
            saved runs keep their configuration.
          </p>
        </details>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void execute('new')
          }}
          className="flex flex-col gap-3"
        >
          <label htmlFor="council-question" className="font-medium">
            Your question
          </label>
          <textarea
            id="council-question"
            className="bg-background min-h-24 rounded-lg border p-3 text-sm"
            placeholder="What difficult question should the council examine?"
            maxLength={60000}
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !ready || !prompt.trim()}>
              Start Council
            </Button>
            <span className="text-muted-foreground text-xs">
              {callCount(config.revisionRounds)} model calls · billed to your
              OpenRouter key
            </span>
          </div>
        </form>
        {error && (
          <p role="status" className="text-sm">
            {error}
          </p>
        )}
        {run && (
          <>
            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">{run.originalPrompt}</p>
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
                  onClick={() =>
                    downloadJson(
                      JSON.stringify(run, null, 2),
                      `council-${run.id}.json`,
                    )
                  }
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
            </div>
            {final?.text && (
              <article className="bg-card rounded-xl border p-5">
                <h2 className="mb-4 text-lg font-semibold">Final answer</h2>
                <Answer text={final.text} />
              </article>
            )}
            {busy && displayStep && displayStep.stage !== 'synthesis' && (
              <Columns step={displayStep} run={run} />
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
          </>
        )}
      </div>
    </section>
  )
}
