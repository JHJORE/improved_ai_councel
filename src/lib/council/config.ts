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
  if (config.backend === 'bedrock') {
    if (!/^[a-z]{2}-(?:gov-)?[a-z]+-\d$/.test(config.region ?? ''))
      throw new Error('Enter a valid AWS region in Settings.')
    if (
      [...config.members.map((m) => m.model), config.chairmanModel].some(
        (id) => !/^[a-zA-Z0-9][a-zA-Z0-9.:/_-]{1,2047}$/.test(id),
      )
    )
      throw new Error(
        'Enter valid Bedrock model IDs or inference profile ARNs in Settings.',
      )
  } else if (
    [...config.members.map((m) => m.model), config.chairmanModel].some(
      (id) => !/^[\w.-]+\/[\w.:-]+$/.test(id),
    )
  ) {
    throw new Error('Use valid provider/model OpenRouter IDs.')
  }
}
export const BEDROCK_COUNCIL_CONFIG: CouncilConfig = {
  backend: 'bedrock',
  region: 'us-east-1',
  members: [
    {
      id: 'claude',
      provider: 'anthropic',
      label: 'Claude',
      model: 'us.anthropic.claude-opus-5-5',
    },
    {
      id: 'gpt',
      provider: 'openai',
      label: 'GPT',
      model: 'us.openai.gpt-6.1-sol',
    },
    {
      id: 'grok',
      provider: 'xai',
      label: 'Grok',
      model: 'us.xai.grok-4.7',
    },
  ],
  chairmanModel: 'us.anthropic.claude-opus-5-5',
  revisionRounds: 1,
}

/** Upgrade only the exact starter preset; preserve user choices and run snapshots. */
export function upgradeBedrockPreset(config: CouncilConfig): CouncilConfig {
  const oldModels = [
    'us.anthropic.claude-sonnet-4-6',
    'us.amazon.nova-2-lite-v1:0',
    'us.meta.llama3-3-70b-instruct-v1:0',
  ]
  if (
    config.backend !== 'bedrock' ||
    config.chairmanModel !== oldModels[0] ||
    config.members.length !== 3 ||
    !config.members.every((m, i) => m.model === oldModels[i])
  )
    return config
  return {
    ...config,
    members: structuredClone(BEDROCK_COUNCIL_CONFIG.members),
    chairmanModel: BEDROCK_COUNCIL_CONFIG.chairmanModel,
  }
}
