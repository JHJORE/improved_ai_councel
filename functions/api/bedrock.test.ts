import { onRequestPost } from './bedrock'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { streamText } from 'ai'
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => vi.fn((model) => model)),
}))
vi.mock('ai', () => ({ streamText: vi.fn() }))
function request(
  overrides: Record<string, unknown> = {},
  origin = 'http://localhost',
) {
  return new Request('http://localhost/api/bedrock', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-test-key',
    },
    body: JSON.stringify({
      region: 'us-east-1',
      model: 'us.anthropic.claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      ...overrides,
    }),
  })
}
beforeEach(() => vi.clearAllMocks())
it('streams Bedrock text and token usage without estimated pricing or credentials', async () => {
  vi.mocked(streamText).mockReturnValue({
    fullStream: (async function* () {
      yield { type: 'text-delta', text: 'Hello' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        totalUsage: { inputTokens: 10, outputTokens: 2 },
      }
    })(),
  } as unknown as ReturnType<typeof streamText>)
  const response = await onRequestPost({ request: request() })
  const body = await response.text()
  expect(body).toContain('Hello')
  expect(body).toContain('prompt_tokens":10')
  expect(body).toContain('[DONE]')
  expect(body).not.toContain('fake-test-key')
  expect(createAmazonBedrock).toHaveBeenCalledWith({
    apiKey: 'fake-test-key',
    region: 'us-east-1',
    baseURL: 'https://bedrock-runtime.us-east-1.amazonaws.com',
  })
  expect(streamText).toHaveBeenCalledWith(
    expect.objectContaining({
      maxRetries: 0,
      onError: expect.any(Function),
      abortSignal: expect.any(AbortSignal),
    }),
  )
})
it('rejects cross-origin requests before contacting AWS', async () => {
  expect(
    (await onRequestPost({ request: request({}, 'https://untrusted.example') }))
      .status,
  ).toBe(403)
  expect(createAmazonBedrock).not.toHaveBeenCalled()
})
it.each([
  { region: 'us-east-1.evil.example' },
  { model: '../../secret' },
  { messages: [{ role: 'user', content: 'x'.repeat(300001) }] },
])('rejects invalid inputs %j', async (overrides) => {
  expect((await onRequestPost({ request: request(overrides) })).status).toBe(
    400,
  )
  expect(createAmazonBedrock).not.toHaveBeenCalled()
})
it('sanitizes SDK failures without marking partial answers complete', async () => {
  vi.mocked(streamText).mockReturnValue({
    fullStream: (async function* () {
      yield { type: 'error', error: new Error('secret-request-key') }
    })(),
  } as unknown as ReturnType<typeof streamText>)
  const body = await (await onRequestPost({ request: request() })).text()
  expect(body).toContain('error')
  expect(body).not.toContain('secret-request-key')
  expect(body).not.toContain('[DONE]')
})
