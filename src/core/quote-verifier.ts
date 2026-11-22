import { findUnquotedAbsoluteWording } from './absolute-wording.js'
import type { EvidenceRecord, VerificationIssue, VerificationVerdict } from './types.js'

export interface ExtractedCitation {
  readonly rawTag: string
  readonly id: string
  readonly sentence: string
  readonly sentenceIndex: number
  readonly quotes: readonly string[]
}

export interface QuoteLocation {
  readonly matched: boolean
  readonly matchKind?: 'exact' | 'normalized'
  readonly charStart?: number
  readonly charEnd?: number
  readonly lineStart?: number
  readonly lineEnd?: number
}

const CITATION_RE = /\[(?:ev|claim|source):([A-Za-z0-9._:-]{1,96})\]/gi
const INLINE_QUOTE_RE = /(?:"([^"\n]{8,300})"|\u201c([^\u201d\n]{8,300})\u201d|\u300c([^\u300d\n]{8,300})\u300d)/g

const EXHAUSTIVE_CLAIM_PATTERNS: readonly RegExp[] = [
  /全文(?:中)?(?:均)?(?:未|没有|找不到|不存在|不包含)/,
  /整个文件(?:中)?(?:均)?(?:未|没有|找不到|不存在|不包含)/,
  /(?:文件中|文档中|全篇)(?:没有任何|不包含任何|共(?:有|计)\s*\d+)/,
  /已(?:完整|全部)阅读/,
  /\b(?:not found anywhere in the (?:entire )?file|nowhere in the (?:entire )?file|entire file (?:contains|has) (?:no|only)|across the entire (?:file|document))\b/i,
]

const TRUNCATION_ACKNOWLEDGEMENT_RE =
  /(?:截断|仅读取|部分内容|尚未读完|未读完|其余部分|后续偏移|nextOffset|truncated|partial read|partially read|first \d+ (?:bytes|lines|chars))/i

function offsetToLine(content: string, offset: number): number {
  let line = 1
  const limit = Math.min(offset, content.length)
  for (let i = 0; i < limit; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

function normalizeWhitespaceWithMap(source: string): { readonly normalized: string; readonly map: number[] } {
  const chars: string[] = []
  const map: number[] = []
  let inSpace = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!
    if (/\s/.test(ch)) {
      if (!inSpace && chars.length > 0) {
        chars.push(' ')
        map.push(i)
        inSpace = true
      }
    } else {
      chars.push(ch)
      map.push(i)
      inSpace = false
    }
  }
  if (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop()
    map.pop()
  }
  return { normalized: chars.join(''), map }
}

/**
 * Deterministic reverse quote locator: checks exact substring first, then
 * whitespace-collapsed substring (preserving original char/line offsets).
 */
export function locateQuoteInSource(sourceText: string, quote: string): QuoteLocation {
  const trimmed = quote.trim()
  if (!sourceText || trimmed.length === 0) return { matched: false }

  const exactIdx = sourceText.indexOf(trimmed)
  if (exactIdx >= 0) {
    const endIdx = exactIdx + trimmed.length
    return {
      matched: true,
      matchKind: 'exact',
      charStart: exactIdx,
      charEnd: endIdx,
      lineStart: offsetToLine(sourceText, exactIdx),
      lineEnd: offsetToLine(sourceText, Math.max(exactIdx, endIdx - 1)),
    }
  }

  const normQuote = trimmed.replace(/\s+/g, ' ')
  const { normalized, map } = normalizeWhitespaceWithMap(sourceText)
  const normIdx = normalized.indexOf(normQuote)
  if (normIdx >= 0) {
    const startOffset = map[normIdx] ?? 0
    const endOffset = (map[normIdx + normQuote.length - 1] ?? startOffset) + 1
    return {
      matched: true,
      matchKind: 'normalized',
      charStart: startOffset,
      charEnd: endOffset,
      lineStart: offsetToLine(sourceText, startOffset),
      lineEnd: offsetToLine(sourceText, Math.max(startOffset, endOffset - 1)),
    }
  }

  return { matched: false }
}

/**
 * Split prose into quote-aware sentences without breaking on decimals (e.g. 5.0%),
 * periods inside quotation marks, or trailing `[ev:...]` tags immediately after punctuation.
 */
function splitSentencesQuoteAware(text: string): string[] {
  const sentences: string[] = []
  let start = 0
  let inAsciiDouble = false
  let cnDoubleDepth = 0
  let cornerDepth = 0

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (ch === '"') {
      inAsciiDouble = !inAsciiDouble
      continue
    }
    if (ch === '\u201c') {
      cnDoubleDepth += 1
      continue
    }
    if (ch === '\u201d' && cnDoubleDepth > 0) {
      cnDoubleDepth -= 1
      continue
    }
    if (ch === '\u300c') {
      cornerDepth += 1
      continue
    }
    if (ch === '\u300d' && cornerDepth > 0) {
      cornerDepth -= 1
      continue
    }

    const insideQuote = inAsciiDouble || cnDoubleDepth > 0 || cornerDepth > 0
    if (ch === '\n') {
      const piece = text.slice(start, i).trim()
      if (piece.length > 0) sentences.push(piece)
      start = i + 1
      inAsciiDouble = false
      cnDoubleDepth = 0
      cornerDepth = 0
      continue
    }

    if (insideQuote) continue

    const isEndPunct = ch === '。' || ch === '!' || ch === '！' || ch === '?' || ch === '？' || ch === '.'
    if (!isEndPunct) continue

    // Ignore decimal numbers like 0.5% or version strings like 0.2.2
    if (ch === '.') {
      const prev = i > 0 ? text[i - 1]! : ''
      const next = i + 1 < text.length ? text[i + 1]! : ''
      if (/\d/.test(prev) && /\d/.test(next)) continue
    }

    // Consume trailing spaces + citation tags belonging to this sentence
    let end = i + 1
    while (end < text.length) {
      const rest = text.slice(end)
      const tagMatch = /^\s*\[(?:ev|claim|source):[A-Za-z0-9._:-]{1,96}\]/i.exec(rest)
      if (tagMatch) {
        end += tagMatch[0].length
      } else {
        break
      }
    }

    const piece = text.slice(start, end).trim()
    if (piece.length > 0) sentences.push(piece)
    start = end
    i = end - 1
  }

  const tail = text.slice(start).trim()
  if (tail.length > 0) sentences.push(tail)
  return sentences
}

export function extractCitations(text: string): ExtractedCitation[] {
  if (!text) return []
  const sentences = splitSentencesQuoteAware(text)

  const results: ExtractedCitation[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    const quotes: string[] = []
    for (const qm of sentence.matchAll(INLINE_QUOTE_RE)) {
      const q = (qm[1] ?? qm[2] ?? qm[3] ?? '').trim()
      if (q.length >= 8) quotes.push(q)
    }

    for (const cm of sentence.matchAll(CITATION_RE)) {
      const id = cm[1]
      if (!id) continue
      results.push({
        rawTag: cm[0],
        id,
        sentence,
        sentenceIndex,
        quotes,
      })
    }
  })
  return results
}

export function detectTruncatedReadViolations(
  text: string,
  evidenceList: readonly EvidenceRecord[],
): VerificationIssue[] {
  const truncatedRecords = evidenceList.filter((e) => e.truncated)
  if (truncatedRecords.length === 0) return []
  if (TRUNCATION_ACKNOWLEDGEMENT_RE.test(text)) return []

  const issues: VerificationIssue[] = []
  for (const pattern of EXHAUSTIVE_CLAIM_PATTERNS) {
    const match = pattern.exec(text)
    if (match) {
      const target = truncatedRecords[0]!
      issues.push({
        code: 'TRUNCATED_EXHAUSTIVE_CLAIM',
        severity: 'error',
        locator: target.locator,
        citationId: target.id,
        message: `Assistant made exhaustive claim "${match[0]}" while evidence "${target.locator}" was truncated (nextOffset=${target.nextOffset ?? 'unknown'}). Continue reading or state partial coverage explicitly.`,
      })
      break
    }
  }
  return issues
}

export interface DeterministicTurnCheckResult {
  readonly verdict: VerificationVerdict
  readonly issues: readonly VerificationIssue[]
  readonly citedEvidenceIds: readonly string[]
  readonly citedPairs: readonly { readonly citationId: string; readonly sentence: string; readonly quote: string; readonly evidence: EvidenceRecord }[]
}

export function verifyTurnDeterministic(
  text: string,
  evidenceList: readonly EvidenceRecord[],
): DeterministicTurnCheckResult {
  const byId = new Map<string, EvidenceRecord>()
  for (const ev of evidenceList) {
    byId.set(ev.id, ev)
  }

  const issues: VerificationIssue[] = []
  const citedIds = new Set<string>()
  const citedPairs: { citationId: string; sentence: string; quote: string; evidence: EvidenceRecord }[] = []

  const citations = extractCitations(text)
  for (const cite of citations) {
    const record = byId.get(cite.id)
    if (!record) {
      issues.push({
        code: 'FABRICATED_CITATION',
        severity: 'error',
        citationId: cite.id,
        message: `Citation ${cite.rawTag} does not exist in registered session evidence.`,
      })
      continue
    }
    citedIds.add(record.id)

    if (record.auditability === 'unverified') {
      issues.push({
        code: 'UNVERIFIED_SOURCE',
        severity: 'warn',
        citationId: record.id,
        locator: record.locator,
        message: `Cited source ${record.locator} has auditability="unverified".`,
      })
    }

    const haystack = record.fullText ?? record.excerpt
    if (cite.quotes.length > 0) {
      for (const quote of cite.quotes) {
        const loc = locateQuoteInSource(haystack, quote)
        if (!loc.matched) {
          issues.push({
            code: 'QUOTE_NOT_LOCATED',
            severity: 'error',
            citationId: record.id,
            locator: record.locator,
            message: `Quoted span "${quote.slice(0, 60)}" could not be reverse-located in evidence ${record.id} (${record.locator}).`,
          })
        } else {
          citedPairs.push({ citationId: record.id, sentence: cite.sentence, quote, evidence: record })
        }
      }
    } else {
      citedPairs.push({ citationId: record.id, sentence: cite.sentence, quote: record.excerpt, evidence: record })
    }
  }

  // Check truncated-read exhaustive claims
  issues.push(...detectTruncatedReadViolations(text, evidenceList))

  // Check absolute wording (warning in general chat; blocking on memory tools)
  const absHits = findUnquotedAbsoluteWording(text)
  if (absHits.length > 0) {
    issues.push({
      code: 'ABSOLUTE_WORDING',
      severity: 'warn',
      message: `Unquoted absolute wording detected: ${[...new Set(absHits)].slice(0, 5).join(', ')}`,
    })
  }

  const hasError = issues.some((i) => i.severity === 'error')
  const hasUnverifiedSource = issues.some((i) => i.code === 'UNVERIFIED_SOURCE')
  let verdict: VerificationVerdict

  if (hasError) {
    verdict = 'contradicted'
  } else if (citedIds.size === 0) {
    verdict = evidenceList.length > 0 ? 'unverified' : 'unverified'
  } else if (hasUnverifiedSource || [...citedIds].some((id) => byId.get(id)?.auditability === 'partial')) {
    verdict = 'partial'
  } else {
    verdict = 'verified'
  }

  return {
    verdict,
    issues,
    citedEvidenceIds: [...citedIds],
    citedPairs,
  }
}
