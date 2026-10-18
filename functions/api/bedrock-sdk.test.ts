import { onRequestPost } from './bedrock'
afterEach(() => vi.unstubAllGlobals())
it('the real Bedrock adapter sends bearer auth to the regional ConverseStream endpoint', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ message: 'Denied' }), {
        status: 403,
        headers: {
          'content-type': 'application/json',
          'x-amzn-errortype': 'AccessDeniedException',
        },
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const request = new Request('http://localhost/api/bedrock', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer fake-bedrock-sdk-test',
    },
    body: JSON.stringify({
      region: 'us-east-1',
      model: 'us.anthropic.claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    }),
  })
  const response = await onRequestPost({ request })
  const text = await response.text()
  expect(fetcher).toHaveBeenCalledOnce()
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(String(url)).toBe(
    'https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/converse-stream',
  )
  expect(new Headers(init.headers).get('authorization')).toBe(
    'Bearer fake-bedrock-sdk-test',
  )
  expect(text).toContain('Bedrock request failed')
  expect(text).not.toContain('fake-bedrock-sdk-test')
})
