import type { AnonymousSet, Candidate } from '@/lib/council/types'
/** Fisher–Yates; injectable RNG makes permutations independently testable. */
export function anonymize(
  candidates: Candidate[],
  random = Math.random,
): AnonymousSet {
  const shuffled = candidates.map((c) => ({ ...c }))
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const mapping: Record<string, string> = {}
  const responses = shuffled.map((c, i) => {
    const id = String.fromCharCode(65 + i)
    mapping[id] = c.id
    return { id, text: c.text }
  })
  return { responses, mapping }
}
/** Remove common self-identification and configured model names from peer material.
 * Writing style can still reveal identity; anonymity is best effort, not cryptographic.
 */
export function redactIdentity(text: string, models: string[] = []): string {
  let result = text
  for (const name of models.filter(Boolean).sort((a, b) => b.length - a.length))
    result = result.split(name).join('[anonymous model]')
  return result.replace(
    /\b(?:Claude(?:[ -](?:Opus|Sonnet|Haiku))?(?:[ -]\d[\w.-]*)?|ChatGPT|GPT(?:[ -]\d[\w.-]*)?|Gemini(?:[ -]\d[\w.-]*)?|Anthropic|OpenAI|Google)\b/gi,
    '[anonymous model]',
  )
}

/** Critique labels belong to an earlier permutation; translate before synthesis. */
export function remapReferences(
  text: string,
  from: Record<string, string>,
  to: Record<string, string>,
): string {
  return text.replace(/Response\s+([A-Z])\b/g, (_match, label: string) => {
    const member = from[label]
    const newLabel = Object.keys(to).find((id) => to[id] === member)
    return newLabel
      ? `Response ${newLabel}`
      : '[earlier candidate excluded from final evaluation]'
  })
}
