/**
 * Settings dialog for API key management and model selection.
 *
 * A single OpenRouter API key field gives access to all three providers
 * (Claude, ChatGPT, Gemini). Each provider has a model selector dropdown.
 *
 * Changes save immediately to Dexie (persistence) and Zustand (runtime).
 * Dialog state is managed locally -- no need for global state.
 */

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { EyeIcon, EyeOffIcon, SettingsIcon } from 'lucide-react'
import { CouncilSettings } from '@/components/CouncilSettings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { db, updateSettings } from '@/lib/db'
import type { Provider } from '@/lib/db/types'
import {
  MODEL_OPTIONS,
  PROVIDER_COLORS,
  PROVIDER_LABELS,
  PROVIDERS,
} from '@/lib/models'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function SettingsDialog() {
  const [open, setOpen] = useState(false)

  // Reactive settings from Dexie
  const settings = useLiveQuery(() => db.settings.get(1), [])

  // Check if this is first run (no OpenRouter API key configured)
  const hasApiKey = settings != null && settings.apiKeys.openrouter !== ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          className={cn(
            'h-10 w-10 sm:h-8 sm:w-8',
            !hasApiKey && 'text-chart-1 animate-pulse',
          )}
        >
          <SettingsIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            One API key for all providers. Get yours at{' '}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              openrouter.ai/keys
            </a>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 pt-2">
          {/* OpenRouter API key (single key for all providers) */}
          <OpenRouterKeySection apiKey={settings?.apiKeys.openrouter ?? ''} />

          <CouncilSettings />
          {/* Separator */}
          <div className="border-border border-t" />

          {/* Per-provider model selectors */}
          <div className="flex flex-col gap-4">
            <span className="text-foreground text-sm font-medium">
              Compare / Cross-feed models
            </span>
            {PROVIDERS.map((provider) => (
              <ProviderModelSection
                key={provider}
                provider={provider}
                selectedModel={settings?.selectedModels[provider] ?? ''}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// OpenRouter API Key Section
// ---------------------------------------------------------------------------

interface OpenRouterKeySectionProps {
  apiKey: string
}

function OpenRouterKeySection({ apiKey }: OpenRouterKeySectionProps) {
  const [showKey, setShowKey] = useState(false)

  const [localKey, setLocalKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const handleApiKeyChange = (value: string) => {
    setLocalKey(value)
    setSaveError('')
    // Enqueue the write immediately; closing the dialog cannot cancel it.
    void updateSettings({ apiKeys: { openrouter: value.trim() } }).catch(() =>
      setSaveError('Could not save your key. Please try again.'),
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {saveError && <p role="alert">{saveError}</p>}
      <label
        htmlFor="openrouter-api-key"
        className="text-foreground text-sm font-medium"
      >
        OpenRouter API Key
      </label>
      <div className="relative">
        <Input
          id="openrouter-api-key"
          type={showKey ? 'text' : 'password'}
          value={localKey ?? apiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
          placeholder="sk-or-..."
          className="pr-9"
          autoComplete="off"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 h-9 w-9"
          onClick={() => setShowKey(!showKey)}
          aria-label={showKey ? 'Hide API key' : 'Show API key'}
        >
          {showKey ? (
            <EyeOffIcon className="h-4 w-4" />
          ) : (
            <EyeIcon className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-Provider Model Section
// ---------------------------------------------------------------------------

interface ProviderModelSectionProps {
  provider: Provider
  selectedModel: string
}

function ProviderModelSection({
  provider,
  selectedModel,
}: ProviderModelSectionProps) {
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const models = MODEL_OPTIONS[provider]

  const handleModelChange = async (modelId: string) => {
    // Update both Dexie (persistence) and Zustand (immediate runtime effect)
    await updateSettings({ selectedModels: { [provider]: modelId } })
    setSelectedModel(provider, modelId)
  }

  return (
    <div className="flex items-center gap-3">
      {/* Provider label with dot */}
      <div className="flex w-20 shrink-0 items-center gap-2">
        <div
          className={cn('h-2 w-2 rounded-full', PROVIDER_COLORS[provider])}
        />
        <span className="text-muted-foreground text-xs">
          {PROVIDER_LABELS[provider]}
        </span>
      </div>

      {/* Model selector */}
      <Select value={selectedModel} onValueChange={handleModelChange}>
        <SelectTrigger id={`${provider}-model`} className="flex-1">
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
