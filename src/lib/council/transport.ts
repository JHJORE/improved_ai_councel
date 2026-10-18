import type { ModelCall, Usage } from '@/lib/council/types'
export interface CatalogModel {
  id: string
  name: string
  pricing: { prompt: string; completion: string }
  supported_parameters?: string[]
}
export async function loadCatalog(): Promise<CatalogModel[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok)
    throw new Error('Could not load OpenRouter models. Try again.')
  return (await response.json()).data
}
export function evaluationSchema(ids: string[]) {
  const score = { type: 'number', minimum: 1, maximum: 10 }
  return {
    type: 'json_schema',
    json_schema: {
      name: 'council_evaluation',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['evaluations', 'ranking'],
        properties: {
          evaluations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'responseId',
                'accuracy',
                'completeness',
                'reasoning',
                'usefulness',
                'flaws',
              ],
              properties: {
                responseId: { type: 'string', enum: ids },
                accuracy: score,
                completeness: score,
                reasoning: score,
                usefulness: score,
                flaws: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          ranking: { type: 'array', items: { type: 'string', enum: ids } },
        },
      },
    },
  }
}
/** Browser → OpenRouter only. The API key exists in this closure, never in a run. */
export function createModelCall(
  apiKey: string,
  catalog: CatalogModel[],
  bedrock?: { region: string },
): ModelCall {
  const provider = bedrock ? 'AWS Bedrock' : 'OpenRouter'
  return async ({ model, prompt, evaluationIds, signal, onText }) => {
    if (prompt.length > 300000)
      throw new Error(
        'Combined context exceeds the 300,000 character safeguard. Export this run and use a narrower question or fewer revision rounds.',
      )
    const info = catalog.find((m) => m.id === model)
    const response = await fetch(
      bedrock
        ? '/api/bedrock'
        : 'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
        body: JSON.stringify({
          ...(bedrock ? { region: bedrock.region } : {}),
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: 16384,
          ...(evaluationIds &&
          info?.supported_parameters?.includes('structured_outputs')
            ? { response_format: evaluationSchema(evaluationIds) }
            : {}),
        }),
      },
    )
    if (!response.ok || !response.body)
      throw new Error(
        `${provider} request failed (${response.status}). Check your key, region, model access and quota in Settings; then retry.`,
      )
    const reader = response.body.getReader(),
      decoder = new TextDecoder()
    let buffer = '',
      text = '',
      done = false,
      finished = false,
      usage: Usage | undefined
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        done = true
        return
      }
      if (!payload) return
      const data = JSON.parse(payload)
      if (data.error)
        throw new Error(
          `${provider} could not complete the request. Check model access, region and quota, then retry.`,
        )
      const choice = data.choices?.[0]
      if (choice?.finish_reason === 'length')
        throw new Error(
          'Answer exceeded the output limit. Narrow the question and start a new run.',
        )
      if (
        choice?.finish_reason === 'error' ||
        choice?.finish_reason === 'content_filter'
      )
        throw new Error(
          'The provider could not finish this answer. Retry or continue with successful models.',
        )
      if (choice?.finish_reason) finished = true
      if (choice?.delta?.content) {
        text += choice.delta.content
        onText(text)
      }
      if (data.usage) {
        const input = data.usage.prompt_tokens ?? 0,
          output = data.usage.completion_tokens ?? 0
        usage = {
          input,
          output,
          cost:
            typeof data.usage.cost === 'number'
              ? data.usage.cost
              : info
                ? input * Number(info.pricing.prompt) +
                  output * Number(info.pricing.completion)
                : null,
        }
      }
    }
    try {
      for (;;) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) consume(line.trimEnd())
        if (chunk.done) {
          if (buffer) consume(buffer)
          break
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (!done || !finished)
      throw new Error(
        'Stream interrupted before completion. Retry this request.',
      )
    return { text, usage }
  }
}
