import type { Evaluation } from '@/lib/council/types'
function permutation(values: unknown, ids: string[]): values is string[] {
  return (
    Array.isArray(values) &&
    values.length === ids.length &&
    new Set(values).size === ids.length &&
    values.every((x) => ids.includes(x))
  )
}
export function parseEvaluation(raw: string, ids: string[]): Evaluation {
  const start = raw.indexOf('{'),
    end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(raw.slice(start, end + 1)) as Evaluation
      if (
        !permutation(value.ranking, ids) ||
        !Array.isArray(value.evaluations) ||
        !permutation(
          value.evaluations.map((x) => x.responseId),
          ids,
        )
      )
        throw new Error()
      if (
        !value.evaluations.every(
          (x) =>
            ['accuracy', 'completeness', 'reasoning', 'usefulness'].every(
              (k) => {
                const n = x[k as 'accuracy']
                return (
                  typeof n === 'number' &&
                  Number.isFinite(n) &&
                  n >= 1 &&
                  n <= 10
                )
              },
            ) &&
            Array.isArray(x.flaws) &&
            x.flaws.every((f) => typeof f === 'string'),
        )
      )
        throw new Error()
      return value
    } catch {
      /* Try the conservative prose fallback below. */
    }
  }
  const section = raw.split(/FINAL RANKING\s*:/i)[1] ?? ''
  const ranking = [
    ...section.matchAll(/^\s*\d+[.)]\s*(?:Response\s+)?([A-Z])\b/gm),
  ].map((m) => m[1])
  // Never invent scores. Missing/invalid scores trigger a targeted retry.
  const evaluations = ids.map((responseId) => {
    const block =
      raw.match(
        new RegExp(
          `Response\\s+${responseId}\\b([\\s\\S]*?)(?=Response\\s+[A-Z]\\b|FINAL RANKING|$)`,
          'i',
        ),
      )?.[1] ?? ''
    const score = (key: string) =>
      Number(
        block.match(
          new RegExp(
            `${key}(?:\\s+quality|\\s*\\/\\s*actionability)?\\s*:\\s*(\\d+(?:\\.\\d+)?)`,
            'i',
          ),
        )?.[1],
      )
    return {
      responseId,
      accuracy: score('accuracy'),
      completeness: score('completeness'),
      reasoning: score('reasoning'),
      usefulness: score('usefulness'),
      flaws: [block.trim()],
    }
  })
  if (
    !permutation(ranking, ids) ||
    evaluations.some((x) =>
      [x.accuracy, x.completeness, x.reasoning, x.usefulness].some(
        (n) => !Number.isFinite(n) || n < 1 || n > 10,
      ),
    )
  )
    throw new Error(
      'Invalid evaluation: expected complete scores and a unique ranking. Retry this judge.',
    )
  return { evaluations, ranking }
}
export function aggregateRanking(
  evaluations: Evaluation[],
  mapping: Record<string, string>,
) {
  if (!evaluations.length) throw new Error('No valid evaluations.')
  return Object.entries(mapping)
    .map(([responseId, memberId]) => ({
      responseId,
      memberId,
      meanRank:
        evaluations.reduce(
          (sum, e) => sum + e.ranking.indexOf(responseId) + 1,
          0,
        ) / evaluations.length,
    }))
    .sort(
      (a, b) =>
        a.meanRank - b.meanRank || a.responseId.localeCompare(b.responseId),
    )
}
