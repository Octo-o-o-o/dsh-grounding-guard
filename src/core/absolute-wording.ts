/**
 * Deterministic Absolute Wording Guard for memory/profile distillation.
 *
 * Flags unquoted, non-negated absolute generalizations (e.g. "总是", "从不",
 * "一定", "绝对", "always", "never", "definitely", "expert").
 * Never rewrites text (rewriting risks fabricating softer claims).
 */

const QUOTE_SPAN_PATTERNS: readonly RegExp[] = [
  /"[^"]*"/g,
  /\u201c[^\u201d]*\u201d/g,
  /'[^']*'/g,
  /\u2018[^\u2019]*\u2019/g,
  /\u300c[^\u300d]*\u300d/g,
  /\u300e[^\u300f]*\u300f/g,
]

const CHINESE_NEGATION_CHARS = new Set(['不', '没', '未', '非', '别', '莫'])
const CHINESE_NEGATION_LOOKBEHIND_CHARS = 3
const ENGLISH_NEGATION_WINDOW_CHARS = 18
const ENGLISH_NEGATION_PATTERN = /\b(?:not|no longer|n't|hardly|rarely)\s+$/i

const ABSOLUTE_RULES: readonly RegExp[] = [
  /\balways\b/gi,
  /\bnever\b/gi,
  /\bdefinitely\b/gi,
  /\bcertainly\b/gi,
  /\babsolutely\b/gi,
  /\bmastered\b/gi,
  /\bmastery\b/gi,
  /\bexpert\b/gi,
  /\bguaranteed\b/gi,
  /\bforever\b/gi,
  /总是/g,
  /从不/g,
  /从来不/g,
  /一定/g,
  /绝对/g,
  /永远/g,
  /必然/g,
  /精通/g,
  /专家/g,
]

function maskQuotedSpans(text: string): string {
  let masked = text
  for (const pattern of QUOTE_SPAN_PATTERNS) {
    masked = masked.replace(pattern, (match) => ' '.repeat(match.length))
  }
  return masked
}

function isNegated(text: string, matchIndex: number): boolean {
  const zhPrefix = text.slice(Math.max(0, matchIndex - CHINESE_NEGATION_LOOKBEHIND_CHARS), matchIndex)
  if ([...zhPrefix].some((ch) => CHINESE_NEGATION_CHARS.has(ch))) return true

  const enPrefix = text.slice(Math.max(0, matchIndex - ENGLISH_NEGATION_WINDOW_CHARS), matchIndex)
  return ENGLISH_NEGATION_PATTERN.test(enPrefix)
}

export function findUnquotedAbsoluteWording(text: string | undefined | null): string[] {
  if (!text) return []
  const masked = maskQuotedSpans(text)
  const hits: string[] = []
  for (const rule of ABSOLUTE_RULES) {
    const re = new RegExp(rule.source, rule.flags)
    for (const match of masked.matchAll(re)) {
      if (match.index === undefined) continue
      if (isNegated(masked, match.index)) continue
      hits.push(match[0])
    }
  }
  return hits
}

export function containsUnquotedAbsoluteWording(text: string | undefined | null): boolean {
  return findUnquotedAbsoluteWording(text).length > 0
}
