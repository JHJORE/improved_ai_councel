import {
  BEDROCK_COUNCIL_CONFIG,
  upgradeBedrockPreset,
  validateConfig,
} from './config'
it('upgrades the exact old preset but preserves region and revision count', () => {
  const old = {
    ...structuredClone(BEDROCK_COUNCIL_CONFIG),
    region: 'us-west-2',
    revisionRounds: 2,
    chairmanModel: 'us.anthropic.claude-sonnet-4-6',
    members: [
      'us.anthropic.claude-sonnet-4-6',
      'us.amazon.nova-2-lite-v1:0',
      'us.meta.llama3-3-70b-instruct-v1:0',
    ].map((model, i) => ({
      id: String(i),
      provider: 'test',
      label: 'test',
      model,
    })),
  }
  const next = upgradeBedrockPreset(old)
  expect(next.members).toEqual(BEDROCK_COUNCIL_CONFIG.members)
  expect(next.region).toBe('us-west-2')
  expect(next.revisionRounds).toBe(2)
  expect(old.members[0].model).toBe('us.anthropic.claude-sonnet-4-6')
  const custom = { ...old, chairmanModel: 'my.custom-model' }
  expect(upgradeBedrockPreset(custom)).toBe(custom)
  expect(() => validateConfig(next)).not.toThrow()
})
