import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { streamText } from 'ai'

/** Same-origin proxy. Keys are request-scoped and never logged or exported. */
export async function onRequestPost({
  request,
}: {
  request: Request
}): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin)
    return new Response('Cross-origin requests are not allowed.', {
      status: 403,
    })
  if (!request.headers.get('content-type')?.includes('application/json'))
    return new Response('JSON required.', { status: 415 })
  const key = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
  if (!key) return new Response('Bedrock API key required.', { status: 401 })
  let body
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return new Response('Invalid JSON.', { status: 400 })
  }
  const { region, model, messages } = body
  if (
    typeof region !== 'string' ||
    !/^[a-z]{2}-(?:gov-)?[a-z]+-\d$/.test(region) ||
    typeof model !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.:/_-]{1,2047}$/.test(model) ||
    !Array.isArray(messages) ||
    messages.length !== 1 ||
    messages[0]?.role !== 'user' ||
    typeof messages[0]?.content !== 'string' ||
    !messages[0].content.trim() ||
    messages[0].content.length > 300000
  )
    return new Response('Invalid region, model or message.', { status: 400 })
  // Fixed AWS endpoint: user input cannot redirect the bearer token elsewhere.
  const suffix = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com'
  const provider = createAmazonBedrock({
    apiKey: key,
    region,
    baseURL: `https://bedrock-runtime.${region}.${suffix}`,
  })
  const controller = new AbortController()
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(300000),
  ])
  const encoder = new TextEncoder()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      const send = (data: unknown) =>
        output.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        const result = streamText({
          model: provider(model),
          prompt: messages[0].content,
          maxOutputTokens: 4096,
          maxRetries: 0,
          onError: () => {},
          abortSignal: signal,
        })
        for await (const part of result.fullStream) {
          if (part.type === 'error' || part.type === 'abort')
            throw new Error('Bedrock request failed')
          if (part.type === 'text-delta')
            send({ choices: [{ delta: { content: part.text } }] })
          if (part.type === 'finish') {
            send({
              choices: [{ finish_reason: part.finishReason }],
              usage: {
                prompt_tokens: part.totalUsage.inputTokens,
                completion_tokens: part.totalUsage.outputTokens,
              },
            })
            output.enqueue(encoder.encode('data: [DONE]\n\n'))
          }
        }
      } catch {
        // SDK errors can contain request details; never echo them to the client.
        if (!signal.aborted)
          send({
            error:
              'Bedrock request failed. Check key, region, model access and quota.',
          })
      } finally {
        if (!cancelled) output.close()
      }
    },
    cancel() {
      cancelled = true
      controller.abort()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  })
}
