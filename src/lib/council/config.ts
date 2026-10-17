import type { CouncilConfig } from '@/lib/council/types'
export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  members: [
    {
      id: 'claude',
      provider: 'anthropic',
      model: 'anthropic/claude-opus-4.6',
      label: 'Claude',
    },
    { id: 'gpt', provider: 'openai', model: 'openai/gpt-5.4', label: 'GPT' },
    {
      id: 'gemini',
      provider: 'google',
      model: 'google/gemini-3.1-pro-preview',
      label: 'Gemini',
    },
  ],
  chairmanModel: 'anthropic/claude-opus-4.6',
  revisionRounds: 1,
}
export const callCount = (rounds: number) => 7 + 6 * rounds
export function validateConfig(config: CouncilConfig) {
  if (
    !Number.isInteger(config.revisionRounds) ||
    config.revisionRounds < 0 ||
    config.revisionRounds > 3
  )
    throw new Error('Revision rounds must be 0–3.')
  if (
    config.members.length !== 3 ||
    new Set(config.members.map((m) => m.id)).size !== 3
  )
    throw new Error('Select three distinct council members.')
  if (
    [...config.members.map((m) => m.model), config.chairmanModel].some(
      (id) => !/^[\w.-]+\/[\w.:-]+$/.test(id),
    )
  )
    throw new Error('Use valid provider/model OpenRouter IDs.')
}
