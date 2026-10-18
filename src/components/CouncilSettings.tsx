import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DEFAULT_COUNCIL_CONFIG, callCount } from '@/lib/council/config'
import { loadConfig, saveConfig } from '@/lib/council/persistence'
import { loadCatalog } from '@/lib/council/transport'
import type { CatalogModel } from '@/lib/council/transport'
import type { CouncilConfig } from '@/lib/council/types'
export function CouncilSettings() {
  const [config, updateConfig] = useState(() =>
    structuredClone(DEFAULT_COUNCIL_CONFIG),
  )
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void loadConfig()
      .then(updateConfig)
      .catch(() => setError('Could not load settings.'))
    void loadCatalog()
      .then(setCatalog)
      .catch(() => setError('Catalog unavailable; saved models still work.'))
  }, [])
  function setConfig(update: (current: CouncilConfig) => CouncilConfig) {
    const next = update(config)
    updateConfig(next)
    void saveConfig(next).catch(() => setError('Could not save settings.'))
  }
  return (
    <div>
      {' '}
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
          Select a catalog suggestion or enter an exact OpenRouter ID. Chairman
          can be any available model. Settings apply to new runs; saved runs
          keep their configuration.
        </p>
      </section>
      {error && <p role="status">{error}</p>}
    </div>
  )
}
