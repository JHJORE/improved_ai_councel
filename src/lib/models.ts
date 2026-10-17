/**
 * Model definitions and display names for all supported AI providers.
 *
 * Each provider has a list of available models with their API IDs and
 * human-readable display names. The default model per provider matches
 * the defaults in the Zustand store and Dexie settings.
 */

import type { Provider } from '@/lib/db/types'

export interface ModelOption {
  /** Model ID sent to the proxy (e.g., 'claude-sonnet-4-6'). */
  id: string
  /** Human-readable label for the UI (e.g., 'Sonnet 4'). */
  label: string
}

/** Available models per provider, ordered by preference (default first). */
export const MODEL_OPTIONS: Record<Provider, ModelOption[]> = {
  claude: [
    { id: 'claude-opus-4-6', label: 'Opus 4.6 (Max Thinking)' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (Max Thinking)' },
  ],
  chatgpt: [
    { id: 'gpt-5.4', label: 'GPT-5.4 (Extra High)' },
    { id: 'gpt-5.2', label: 'GPT-5.2 (Extra High)' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex (Extra High)' },
  ],
  gemini: [{ id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (High)' }],
}

/**
 * Maps internal model IDs to OpenRouter-compatible model IDs.
 *
 * OpenRouter uses `vendor/model` format. Models that already use this format
 * (e.g., Gemini) map to themselves. Direct API model IDs (Claude, OpenAI)
 * need a vendor prefix.
 */
export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  // Claude
  'claude-opus-4-6': 'anthropic/claude-opus-4.6',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',

  // OpenAI
  'gpt-5.4': 'openai/gpt-5.4',
  'gpt-5.2': 'openai/gpt-5.2',
  'gpt-5.3-codex': 'openai/gpt-5.3-codex',

  // Gemini (already OpenRouter format)
  'google/gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
}

/**
 * Resolve a model ID to its OpenRouter equivalent.
 * Returns the mapped ID if one exists, otherwise returns the original ID
 * (assumes it may already be in OpenRouter format).
 */
export function toOpenRouterModelId(modelId: string): string {
  return OPENROUTER_MODEL_MAP[modelId] ?? modelId
}

/** All supported providers, derived from MODEL_OPTIONS keys. */
export const PROVIDERS: readonly Provider[] = Object.freeze(
  Object.keys(MODEL_OPTIONS) as Provider[],
)

/** Default model ID per provider (first entry in MODEL_OPTIONS). */
export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: MODEL_OPTIONS.claude[0].id,
  chatgpt: MODEL_OPTIONS.chatgpt[0].id,
  gemini: MODEL_OPTIONS.gemini[0].id,
}

/** Flat map from model ID to display name for quick lookups. */
export const MODEL_DISPLAY_NAMES: Record<string, string> = Object.values(
  MODEL_OPTIONS,
)
  .flat()
  .reduce(
    (acc, opt) => {
      acc[opt.id] = opt.label
      return acc
    },
    {} as Record<string, string>,
  )

/**
 * Get the display name for a model ID.
 * Falls back to the raw ID if no display name is registered.
 */
export function getModelDisplayName(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId] ?? modelId
}

/** Provider display labels used throughout the UI. */
export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
}

/** Provider-specific accent colors for column headers and settings. */
export const PROVIDER_COLORS: Record<Provider, string> = {
  claude: 'bg-chart-1',
  chatgpt: 'bg-chart-2',
  gemini: 'bg-chart-3',
}
