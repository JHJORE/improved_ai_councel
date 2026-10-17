/**
 * Unit tests for the pricing module.
 *
 * Tests cost calculation, formatting, and pricing table coverage.
 */

import {
  MODEL_PRICING,
  calculateCost,
  calculateTotalCost,
  formatCost,
  formatTokenCount,
} from '@/lib/pricing'
import { MODEL_OPTIONS } from '@/lib/models'

describe('MODEL_PRICING', () => {
  it('has pricing for all Claude models', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toBeDefined()
    expect(MODEL_PRICING['claude-opus-4-6']).toBeDefined()
  })

  it('has pricing for all OpenAI models', () => {
    expect(MODEL_PRICING['gpt-5.2']).toBeDefined()
    expect(MODEL_PRICING['gpt-5.3-codex']).toBeDefined()
  })

  it('has pricing for all Gemini models', () => {
    expect(MODEL_PRICING['google/gemini-3.1-pro-preview']).toBeDefined()
  })

  it('has pricing for every model in MODEL_OPTIONS', () => {
    const allModelIds = Object.values(MODEL_OPTIONS)
      .flat()
      .map((opt) => opt.id)
    for (const modelId of allModelIds) {
      expect(
        MODEL_PRICING[modelId],
        `Missing pricing for ${modelId}`,
      ).toBeDefined()
    }
  })

  it('has positive prices for all models', () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPer1M).toBeGreaterThan(0)
      expect(pricing.outputPer1M).toBeGreaterThan(0)
      // Output is generally more expensive than or equal to input
      expect(pricing.outputPer1M).toBeGreaterThanOrEqual(pricing.inputPer1M)
    }
  })

  it('does not contain deprecated model IDs', () => {
    const deprecated = [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-3-5-20241022',
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o3-mini',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-pro-preview-06-05',
    ]
    for (const old of deprecated) {
      expect(
        MODEL_PRICING[old],
        `Deprecated model ${old} should not be in pricing table`,
      ).toBeUndefined()
    }
  })

  it('has correct specific pricing for Claude models', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toEqual({
      inputPer1M: 3,
      outputPer1M: 15,
    })
    expect(MODEL_PRICING['claude-opus-4-6']).toEqual({
      inputPer1M: 5,
      outputPer1M: 25,
    })
  })

  it('has correct specific pricing for OpenAI models', () => {
    expect(MODEL_PRICING['gpt-5.2']).toEqual({
      inputPer1M: 1.75,
      outputPer1M: 14,
    })
    expect(MODEL_PRICING['gpt-5.3-codex']).toEqual({
      inputPer1M: 1.75,
      outputPer1M: 14,
    })
  })

  it('has correct specific pricing for Gemini models', () => {
    expect(MODEL_PRICING['google/gemini-3.1-pro-preview']).toEqual({
      inputPer1M: 1.25,
      outputPer1M: 10,
    })
  })

  it('contains pricing entries for both direct and OpenRouter model IDs', () => {
    // 6 direct API IDs + 5 OpenRouter aliases (Gemini is same in both)
    expect(Object.keys(MODEL_PRICING).length).toBe(11)
  })

  it('has matching pricing between direct and OpenRouter model IDs', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toEqual(
      MODEL_PRICING['anthropic/claude-sonnet-4.6'],
    )
    expect(MODEL_PRICING['claude-opus-4-6']).toEqual(
      MODEL_PRICING['anthropic/claude-opus-4.6'],
    )
    expect(MODEL_PRICING['gpt-5.2']).toEqual(
      MODEL_PRICING['openai/gpt-5.2'],
    )
    expect(MODEL_PRICING['gpt-5.3-codex']).toEqual(
      MODEL_PRICING['openai/gpt-5.3-codex'],
    )
  })
})

describe('calculateCost', () => {
  it('calculates cost for Claude Sonnet 4.6', () => {
    // 1000 input tokens at $3/1M = $0.003
    // 500 output tokens at $15/1M = $0.0075
    const cost = calculateCost('claude-sonnet-4-6', {
      input: 1000,
      output: 500,
    })
    expect(cost).toBeCloseTo(0.0105, 6)
  })

  it('calculates cost for Claude Opus 4.6', () => {
    // 1M input tokens at $5/1M = $5
    // 1M output tokens at $25/1M = $25
    const cost = calculateCost('claude-opus-4-6', {
      input: 1_000_000,
      output: 1_000_000,
    })
    expect(cost).toBeCloseTo(30, 2)
  })

  it('calculates cost for GPT-5.2', () => {
    // 5000 input tokens at $1.75/1M = $0.00875
    // 2000 output tokens at $14/1M = $0.028
    const cost = calculateCost('gpt-5.2', { input: 5000, output: 2000 })
    expect(cost).toBeCloseTo(0.03675, 6)
  })

  it('calculates cost for Gemini 3.1 Pro', () => {
    // 10000 input tokens at $1.25/1M = $0.0125
    // 5000 output tokens at $10/1M = $0.05
    const cost = calculateCost('google/gemini-3.1-pro-preview', {
      input: 10000,
      output: 5000,
    })
    expect(cost).toBeCloseTo(0.0625, 6)
  })

  it('returns null for unknown models', () => {
    const cost = calculateCost('unknown-model', { input: 1000, output: 500 })
    expect(cost).toBeNull()
  })

  it('returns 0 for zero tokens', () => {
    const cost = calculateCost('gpt-5.2', { input: 0, output: 0 })
    expect(cost).toBe(0)
  })

  it('handles input-only usage', () => {
    const cost = calculateCost('gpt-5.2', { input: 1_000_000, output: 0 })
    expect(cost).toBeCloseTo(1.75, 2)
  })

  it('handles output-only usage', () => {
    const cost = calculateCost('gpt-5.2', { input: 0, output: 1_000_000 })
    expect(cost).toBeCloseTo(14, 2)
  })
})

describe('calculateTotalCost', () => {
  it('sums costs across multiple token counts', () => {
    const cost = calculateTotalCost('gpt-5.2', [
      { input: 1000, output: 500 },
      { input: 2000, output: 1000 },
      { input: 3000, output: 1500 },
    ])
    // Total: 6000 input at $1.75/1M + 3000 output at $14/1M
    // = $0.0105 + $0.042 = $0.0525
    expect(cost).toBeCloseTo(0.0525, 6)
  })

  it('returns null for unknown models', () => {
    const cost = calculateTotalCost('unknown-model', [
      { input: 1000, output: 500 },
    ])
    expect(cost).toBeNull()
  })

  it('handles empty array', () => {
    const cost = calculateTotalCost('gpt-5.2', [])
    expect(cost).toBe(0)
  })

  it('handles single token count', () => {
    const single = calculateCost('gpt-5.2', { input: 1000, output: 500 })
    const total = calculateTotalCost('gpt-5.2', [{ input: 1000, output: 500 }])
    expect(total).toEqual(single)
  })
})

describe('formatCost', () => {
  it('formats zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('formats very small amounts as < $0.01', () => {
    expect(formatCost(0.001)).toBe('< $0.01')
    expect(formatCost(0.009)).toBe('< $0.01')
    expect(formatCost(0.0001)).toBe('< $0.01')
  })

  it('formats cents with two decimal places', () => {
    expect(formatCost(0.01)).toBe('$0.01')
    expect(formatCost(0.05)).toBe('$0.05')
    expect(formatCost(0.99)).toBe('$0.99')
  })

  it('formats dollars with two decimal places', () => {
    expect(formatCost(1)).toBe('$1.00')
    expect(formatCost(1.23)).toBe('$1.23')
    expect(formatCost(10.5)).toBe('$10.50')
    expect(formatCost(100)).toBe('$100.00')
  })
})

describe('formatTokenCount', () => {
  it('formats small numbers as-is', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(1)).toBe('1')
    expect(formatTokenCount(999)).toBe('999')
  })

  it('formats thousands with one decimal place', () => {
    expect(formatTokenCount(1000)).toBe('1.0K')
    expect(formatTokenCount(1500)).toBe('1.5K')
    expect(formatTokenCount(9999)).toBe('10.0K')
  })

  it('formats ten-thousands and above as rounded K', () => {
    expect(formatTokenCount(10000)).toBe('10K')
    expect(formatTokenCount(50000)).toBe('50K')
    expect(formatTokenCount(100000)).toBe('100K')
    expect(formatTokenCount(999499)).toBe('999K')
  })

  it('formats values near 1M as M not K', () => {
    expect(formatTokenCount(999500)).toBe('1.0M')
    expect(formatTokenCount(999999)).toBe('1.0M')
  })

  it('formats millions with one decimal place', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(2_500_000)).toBe('2.5M')
  })
})
