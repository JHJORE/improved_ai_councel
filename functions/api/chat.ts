/**
 * Cloudflare Pages Function: POST /api/chat
 *
 * Stateless proxy that forwards chat requests to AI providers via OpenRouter
 * using the Vercel AI SDK. Streams responses back to the SPA with CORS headers.
 *
 * Request body: { provider, model, messages, apiKey }
 * Response: UI message stream (SSE) compatible with @ai-sdk/react useChat
 */

import { streamText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Provider = 'claude' | 'chatgpt' | 'gemini'

interface ChatRequestBody {
  provider: Provider
  model: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  apiKey: string
}

interface ProxyErrorResponse {
  error: {
    code: string
    message: string
    provider?: Provider
  }
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

/**
 * Maps provider/SDK errors to a consistent JSON error shape with an
 * appropriate HTTP status code.
 */
function mapError(
  err: unknown,
  provider?: Provider,
): { status: number; body: ProxyErrorResponse } {
  const message =
    err instanceof Error ? err.message : 'An unexpected error occurred'

  // Detect common error categories from provider error messages
  const messageLower = message.toLowerCase()

  if (
    messageLower.includes('api key') ||
    messageLower.includes('authentication') ||
    messageLower.includes('unauthorized') ||
    messageLower.includes('invalid x-api-key') ||
    messageLower.includes('incorrect api key')
  ) {
    return {
      status: 401,
      body: {
        error: {
          code: 'invalid_api_key',
          message: `Invalid API key for ${provider ?? 'provider'}. Please check your key and try again.`,
          provider,
        },
      },
    }
  }

  if (
    messageLower.includes('rate limit') ||
    messageLower.includes('too many requests') ||
    messageLower.includes('quota')
  ) {
    return {
      status: 429,
      body: {
        error: {
          code: 'rate_limited',
          message: `Rate limit exceeded for ${provider ?? 'provider'}. ${message}`,
          provider,
        },
      },
    }
  }

  if (
    messageLower.includes('timeout') ||
    messageLower.includes('timed out') ||
    messageLower.includes('deadline')
  ) {
    return {
      status: 504,
      body: {
        error: {
          code: 'timeout',
          message: `Request to ${provider ?? 'provider'} timed out. Please try again.`,
          provider,
        },
      },
    }
  }

  if (
    messageLower.includes('overloaded') ||
    messageLower.includes('service unavailable') ||
    messageLower.includes('internal server error') ||
    messageLower.includes('bad gateway')
  ) {
    return {
      status: 502,
      body: {
        error: {
          code: 'provider_error',
          message: `${provider ?? 'Provider'} is currently unavailable. Please try again later.`,
          provider,
        },
      },
    }
  }

  if (
    messageLower.includes('model not found') ||
    messageLower.includes('model does not exist') ||
    messageLower.includes('model not available') ||
    (messageLower.includes('not found') && messageLower.includes('model'))
  ) {
    return {
      status: 400,
      body: {
        error: {
          code: 'invalid_model',
          message: `Model not found or not available for ${provider ?? 'provider'}. ${message}`,
          provider,
        },
      },
    }
  }

  // Fallback: unknown error
  return {
    status: 500,
    body: {
      error: {
        code: 'internal_error',
        message,
        provider,
      },
    },
  }
}

function errorResponse(status: number, body: ProxyErrorResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  })
}

// ---------------------------------------------------------------------------
// Request Validation
// ---------------------------------------------------------------------------

const VALID_PROVIDERS: Provider[] = ['claude', 'chatgpt', 'gemini']

function validateRequestBody(
  body: unknown,
): { valid: true; data: ChatRequestBody } | { valid: false; error: string } {
  if (body === null || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.' }
  }

  const obj = body as Record<string, unknown>

  if (
    typeof obj.provider !== 'string' ||
    !VALID_PROVIDERS.includes(obj.provider as Provider)
  ) {
    return {
      valid: false,
      error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}.`,
    }
  }

  if (typeof obj.model !== 'string' || obj.model.trim() === '') {
    return { valid: false, error: 'Model must be a non-empty string.' }
  }

  if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
    return {
      valid: false,
      error: 'Messages must be a non-empty array.',
    }
  }

  for (let i = 0; i < obj.messages.length; i++) {
    const msg = obj.messages[i] as Record<string, unknown>
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      return {
        valid: false,
        error: `Message at index ${i} has invalid role. Must be "user" or "assistant".`,
      }
    }
    if (typeof msg.content !== 'string') {
      return {
        valid: false,
        error: `Message at index ${i} must have string content.`,
      }
    }
  }

  if (typeof obj.apiKey !== 'string' || obj.apiKey.trim() === '') {
    return { valid: false, error: 'API key must be a non-empty string.' }
  }

  return { valid: true, data: obj as unknown as ChatRequestBody }
}

// ---------------------------------------------------------------------------
// Provider Model Creation
// ---------------------------------------------------------------------------

/**
 * Creates a language model instance routed through OpenRouter.
 *
 * All providers use OpenRouter by default — one API key gives access to
 * Claude, ChatGPT, and Gemini. The model ID should already be in
 * OpenRouter format (e.g., 'anthropic/claude-sonnet-4-6').
 */
function createModel(_provider: Provider, model: string, apiKey: string) {
  const openrouter = createOpenRouter({ apiKey })
  return openrouter(model)
}

/**
 * Provider-specific options to enable thinking/reasoning for each provider.
 *
 * All providers route through OpenRouter, so all use the `openrouter` key.
 * These are spread into the OpenRouter API request body by the provider SDK.
 *
 * - Claude: Adaptive thinking + max effort via Anthropic pass-through params.
 *   `thinking` enables adaptive extended thinking; `output_config.effort: 'max'`
 *   provides the absolute highest reasoning capability (Opus 4.6 only).
 *   OpenRouter maps these to Anthropic's native API format.
 * - OpenAI: reasoning effort set to 'xhigh' (~95% of max_tokens for reasoning)
 * - Gemini: reasoning effort set to 'high' (max for Gemini; xhigh maps to high)
 */
const PROVIDER_OPTIONS = {
  claude: {
    openrouter: {
      thinking: { type: 'adaptive' },
      output_config: { effort: 'max' },
    },
  },
  chatgpt: {
    openrouter: {
      reasoning: { effort: 'xhigh' },
    },
  },
  gemini: {
    openrouter: {
      reasoning: { effort: 'high' },
    },
  },
} as const satisfies Record<Provider, Record<string, Record<string, unknown>>>

/**
 * Maximum output tokens per provider.
 *
 * Without an explicit limit, OpenRouter uses a modest model default (often
 * ~4 096) which is easily exhausted during verbose cross-feed rounds.
 *
 * - Claude / Gemini: output tokens are independent of thinking/reasoning
 *   tokens, so 16 384 is purely for the visible response.
 * - ChatGPT: OpenAI's API shares the completion budget between reasoning and
 *   output tokens.  With `xhigh` effort, reasoning can consume the majority
 *   of the budget — so we request a much larger ceiling to ensure enough
 *   headroom for the visible response.
 */
const MAX_OUTPUT_TOKENS: Record<Provider, number> = {
  claude: 16_384,
  chatgpt: 65_536,
  gemini: 16_384,
}

// ---------------------------------------------------------------------------
// Stream Keep-Alive
// ---------------------------------------------------------------------------

/**
 * Maximum time (ms) to wait for a provider response before aborting.
 * Reasoning models (GPT with xhigh effort, Claude with extended thinking)
 * can take minutes before emitting the first token. 5 minutes is generous
 * enough for deep reasoning while still preventing infinite hangs.
 */
const STREAM_TIMEOUT_MS = 300_000

/**
 * Interval (ms) between SSE keep-alive comments injected into the stream.
 * Cloudflare (and other proxies) may close idle connections after ~100s.
 * 15s is well within that limit.
 */
const KEEPALIVE_INTERVAL_MS = 15_000

/**
 * Wraps a streaming Response to inject SSE keep-alive comments during idle
 * periods. This prevents Cloudflare (and other reverse proxies) from closing
 * connections that appear idle while AI models reason internally.
 *
 * SSE comments (lines starting with `:`) are defined by the spec to be
 * ignored by clients, so they are safe to inject into any SSE stream.
 */
function withKeepAlive(response: Response): Response {
  const body = response.body
  if (!body) return response

  const encoder = new TextEncoder()
  const keepAliveData = encoder.encode(': keepalive\n\n')
  const reader = body.getReader()

  let timer: ReturnType<typeof setInterval> | null = null
  let closed = false
  let receivedDataChunks = 0

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send keep-alive comments on a fixed interval
      timer = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(keepAliveData)
          } catch {
            // Stream already closed/errored — clean up
            closed = true
            if (timer) clearInterval(timer)
          }
        }
      }, KEEPALIVE_INTERVAL_MS)

      // Pump data from the original stream to our wrapper
      ;(async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) {
              closed = true
              if (timer) clearInterval(timer)
              if (receivedDataChunks === 0) {
                console.warn(
                  '[proxy] Stream ended without sending any data — upstream provider may have timed out during reasoning',
                )
              }
              controller.close()
              return
            }
            receivedDataChunks++
            controller.enqueue(value)
          }
        } catch (err) {
          closed = true
          if (timer) clearInterval(timer)
          controller.error(err)
        }
      })()
    },
    cancel() {
      closed = true
      if (timer) clearInterval(timer)
      reader.cancel()
    },
  })

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

/**
 * Handle CORS preflight requests.
 */
export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}

/**
 * Handle POST /api/chat — the main proxy endpoint.
 *
 * Accepts { provider, model, messages, apiKey } and streams the AI
 * response back using the AI SDK's UI message stream format, which is
 * compatible with the useChat hook on the client.
 */
export const onRequestPost: PagesFunction = async (context) => {
  // Parse request body
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return errorResponse(400, {
      error: {
        code: 'invalid_json',
        message: 'Request body must be valid JSON.',
      },
    })
  }

  // Validate
  const validation = validateRequestBody(body)
  if (!validation.valid) {
    return errorResponse(400, {
      error: {
        code: 'validation_error',
        message: validation.error,
      },
    })
  }

  const { provider, model, messages, apiKey } = validation.data

  try {
    // Create the provider-specific model instance
    const languageModel = createModel(provider, model, apiKey)

    // Stream the response using AI SDK with provider-specific thinking/reasoning.
    // The abort signal ensures we don't wait forever for providers that hang
    // (e.g., during long reasoning phases that exceed infrastructure timeouts).
    const result = streamText({
      model: languageModel,
      messages,
      maxOutputTokens: MAX_OUTPUT_TOKENS[provider],
      providerOptions: PROVIDER_OPTIONS[provider],
      abortSignal: AbortSignal.any([
        context.request.signal,
        AbortSignal.timeout(STREAM_TIMEOUT_MS),
      ]),
    })

    // Return the stream as a UI message stream response (compatible with useChat).
    // The onError callback transforms provider errors into user-friendly messages
    // that are sent to the client via the stream protocol.
    // The messageMetadata callback extracts token usage from the finish event
    // and sends it to the client as message metadata.
    const streamResponse = result.toUIMessageStreamResponse({
      sendReasoning: true,
      onError: (err) => {
        console.error(`[proxy] ${provider} stream error`)
        const { body } = mapError(err, provider)
        return body.error.message
      },
      messageMetadata: ({ part }) => {
        if (part.type === 'finish') {
          return {
            usage: {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
            },
          }
        }
        return undefined
      },
    })

    // Wrap in keep-alive to prevent idle connection timeouts during
    // long reasoning phases, then add CORS headers.
    return corsResponse(withKeepAlive(streamResponse))
  } catch (err) {
    console.error(`[proxy] ${provider} request failed`)
    const { status, body: errorBody } = mapError(err, provider)
    return errorResponse(status, errorBody)
  }
}
