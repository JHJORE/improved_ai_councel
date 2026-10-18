import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateSettings } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DEFAULT_COUNCIL_CONFIG,
  BEDROCK_COUNCIL_CONFIG,
  callCount,
} from '@/lib/council/config'
import { loadConfig, saveConfig } from '@/lib/council/persistence'
import { loadCatalog } from '@/lib/council/transport'
import type { CatalogModel } from '@/lib/council/transport'
import type { CouncilConfig } from '@/lib/council/types'
export function CouncilSettings() {
  const [config, updateConfig] = useState(() =>
    structuredClone(DEFAULT_COUNCIL_CONFIG),
  )
  const settings = useLiveQuery(() => db.settings.get(1), [])
  const [keyDraft, setKeyDraft] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void loadConfig()
      .then((c) => {
        updateConfig(c)
        if (c.backend !== 'bedrock')
          void loadCatalog()
            .then(setCatalog)
            .catch(() => setError('Catalog unavailable. Try again later.'))
      })
      .catch(() => setError('Could not load settings.'))
  }, [])
  function setConfig(update: (current: CouncilConfig) => CouncilConfig) {
    const next = update(config)
    updateConfig(next)
    void saveConfig(next).catch(() => setError('Could not save settings.'))
  }
  return (
    <div>
      <label className="text-sm">
        Chat provider
        <select
          aria-label="Chat provider"
          className="bg-background ml-2 rounded border p-2"
          value={config.backend ?? 'openrouter'}
          onChange={(e) => {
            const backend = e.target.value
            setConfig((c) => ({
              ...structuredClone(
                backend === 'bedrock'
                  ? BEDROCK_COUNCIL_CONFIG
                  : DEFAULT_COUNCIL_CONFIG,
              ),
              revisionRounds: c.revisionRounds,
            }))
            setError('')
            if (backend === 'openrouter')
              void loadCatalog()
                .then(setCatalog)
                .catch(() => setError('Catalog unavailable.'))
          }}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="bedrock">AWS Bedrock</option>
        </select>
      </label>
      {config.backend === 'bedrock' && (
        <div className="my-4 flex flex-col gap-3">
          <label className="text-sm">
            AWS Bedrock API key
            <Input
              aria-label="AWS Bedrock API key"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              value={keyDraft ?? settings?.apiKeys.bedrock ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setKeyDraft(value)
                void updateSettings({
                  apiKeys: { bedrock: value.trim() },
                }).catch(() => setError('Could not save your Bedrock key.'))
              }}
            />
          </label>
          <Button variant="outline" onClick={() => setShowKey((v) => !v)}>
            {showKey ? 'Hide Bedrock key' : 'Show Bedrock key'}
          </Button>
          <label className="text-sm">
            AWS region
            <Input
              aria-label="AWS region"
              value={config.region ?? 'us-east-1'}
              onChange={(e) =>
                setConfig((c) => ({ ...c, region: e.target.value.trim() }))
              }
            />
          </label>
          <p className="text-muted-foreground text-xs">
            Use a Bedrock bearer API key, not an IAM access key. Changes save
            automatically. Choose models enabled in your AWS region. Requests go
            through the local server directly to AWS.
          </p>
        </div>
      )}
      <section className="rounded-lg border p-3">
        <h3 className="font-medium">
          Council settings · {config.revisionRounds} revision round(s) ·{' '}
          {callCount(config.revisionRounds)} planned calls
        </h3>
        <fieldset className="mt-4 grid gap-3 md:grid-cols-2">
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
                  .filter(
                    (m) =>
                      config.backend !== 'bedrock' &&
                      m.id.startsWith(member.provider + '/'),
                  )
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
              {(config.backend === 'bedrock' ? [] : catalog).map((m) => (
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
          {config.backend !== 'bedrock' && (
            <div className="flex gap-2">
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
          )}
        </fieldset>
        <p className="text-muted-foreground mt-3 text-xs">
          {config.backend === 'bedrock'
            ? 'Enter Bedrock model IDs or inference profile ARNs. Defaults use US inference profiles; change them for other regions. '
            : 'Select a catalog suggestion or enter an exact OpenRouter ID. '}
          Chairman can be any available model. Settings apply to new runs; saved
          runs keep their configuration.
        </p>
      </section>
      {error && <p role="status">{error}</p>}
    </div>
  )
}
