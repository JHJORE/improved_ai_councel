import { createModelCall, evaluationSchema } from '@/lib/council/transport'
const event = (data: unknown) =>
  `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
const request = {
  model: 'test/model',
  prompt: 'Question',
  signal: new AbortController().signal,
  onText: vi.fn(),
}
afterEach(() => vi.unstubAllGlobals())
it('streams UTF-8 across chunks, reads usage, sends structured schema', async () => {
  const payload =
    event({ choices: [{ delta: { content: 'héllo' } }] }) +
    event({
      choices: [{ finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3, cost: 0.01 },
    }) +
    event('[DONE]')
  const bytes = new TextEncoder().encode(payload)
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const byte of bytes) c.enqueue(new Uint8Array([byte]))
            c.close()
          },
        }),
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  const call = createModelCall('fake-key', [
    {
      id: 'test/model',
      name: 'test',
      pricing: { prompt: '0.01', completion: '0.02' },
      supported_parameters: ['structured_outputs'],
    },
  ])
  const result = await call({ ...request, evaluationIds: ['A', 'B'] })
  expect(result).toEqual({
    text: 'héllo',
    usage: { input: 2, output: 3, cost: 0.01 },
  })
  const body = JSON.parse(
    (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as string,
  )
  expect(body.response_format).toEqual(evaluationSchema(['A', 'B']))
})
it.each([
  '',
  event({ choices: [{ delta: { content: 'partial' } }] }),
  event({ choices: [{ finish_reason: 'length' }] }) + event('[DONE]'),
  event({ error: { message: 'secret detail' } }),
])(
  'rejects interrupted, truncated and error streams without leaking raw details',
  async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(payload)),
    )
    await expect(createModelCall('fake-key', [])(request)).rejects.toThrow()
  },
)
it('reports HTTP error without including response secrets', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('secret-token', { status: 401 })),
  )
  await expect(createModelCall('fake-key', [])(request)).rejects.toThrow(
    'OpenRouter request failed (401)',
  )
})
it('routes Bedrock through the local proxy with bearer auth and unknown cost', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        event({ choices: [{ delta: { content: 'AWS answer' } }] }) +
          event({
            choices: [{ finish_reason: 'stop' }],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          }) +
          event('[DONE]'),
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  const result = await createModelCall('fake-bedrock-key', [], {
    region: 'us-east-1',
  })({ ...request, model: 'us.anthropic.claude-sonnet-4-6' })
  expect(fetcher.mock.calls[0]).toEqual([
    '/api/bedrock',
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer fake-bedrock-key',
      }),
      body: expect.stringContaining('"region":"us-east-1"'),
    }),
  ])
  expect(result).toEqual({
    text: 'AWS answer',
    usage: { input: 12, output: 3, cost: null },
  })
})
