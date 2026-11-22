/**
 * Strict v2 structured data-query `answerBlocks` validator & deterministic renderer.
 *
 * Enforces the zero-model-authored-numbers contract: models output only JSON
 * referencing disclosed `(runId, row, column)` cells, tables, metadata keys,
 * choices, or standard notices. All rendered numbers come deterministically from
 * host-registered query views. Zero runtime schema-library dependencies.
 */
import type { CheckedAnswerBlocks, QueryResultView } from './types.js'

const NOTICE_MESSAGES = {
  insufficient_evidence: [
    '现有依据不足以给出所问结论；请补充对应数据或已确认的业务口径。',
    'The available evidence is insufficient. Please provide the relevant data or confirmed business definition.',
  ],
  clarify_scope: [
    '请明确所需指标、分类字段或统计期间；下列口径与结果供核对，不合并不同定义。',
    'Please clarify the metric, classification field, or period. The definitions and results below remain separate.',
  ],
  unknown_unit: [
    '不能在原始单位或换算依据未确认时给出换算结论。',
    'No conversion can be stated without a confirmed source unit and conversion basis.',
  ],
  read_only: [
    '问数只提供只读查询，不执行删除、更新或写回。',
    'Data query is read-only and does not delete, update, or write back records.',
  ],
  selected_asset_only: [
    '本轮只查询当前所选且获授权的资产；其他资产需另行选择并通过权限校验。',
    'This request is limited to the selected, authorized asset. Other assets require explicit selection and authorization.',
  ],
  unverified_assumption: [
    '未经确认的假设不能作为正式统计、实际变化或业务认定。',
    'An unconfirmed assumption is not an official statistic, actual change, or business finding.',
  ],
  no_forecast: [
    '不能仅凭当前查询结果给出未来的确定预测；需要明确的预测依据。',
    'Current query results alone cannot establish a certain forecast; an explicit forecasting basis is required.',
  ],
  no_join_evidence: [
    '没有经过确认的关联依据时，不按名称相似或单位相同推断记录对应关系。',
    'Do not infer record relationships from similar names or shared organizations without a confirmed join definition.',
  ],
  record_grain: [
    '记录数量不自动等于独立业务实体数量；应按已确认的粒度和唯一性规则解释。',
    'A record count is not automatically a unique business entity count; confirmed grain and uniqueness rules apply.',
  ],
} as const

type NoticeCode = keyof typeof NOTICE_MESSAGES
const NUMERIC_TYPES = new Set(['integer', 'decimal', 'float', 'number'])
const EXPECT_VALUES = new Set(['numeric', 'text', 'date', 'boolean', 'any'])

function escapeValue(value: unknown): string {
  return String(value).replace(/[\r\n\t]+/g, ' ').trim()
}

function fail(
  code: NonNullable<CheckedAnswerBlocks['code']>,
  reason: string,
): CheckedAnswerBlocks {
  return { ok: false, code, reason }
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k))
}

const ROOT_KEYS = new Set(['version', 'kind', 'language', 'blocks'])
const FACT_KEYS = new Set(['type', 'runId', 'row', 'column', 'dimensions', 'expect'])
const TABLE_KEYS = new Set(['type', 'runId'])
const META_KEYS = new Set(['type', 'key'])
const CHOICE_KEYS = new Set(['type', 'key'])
const NOTICE_KEYS = new Set(['type', 'code'])

export function verifyAndRenderAnswerBlocks(
  raw: string,
  views: ReadonlyMap<string, QueryResultView>,
  metadata: ReadonlyMap<string, string> = new Map(),
): CheckedAnswerBlocks {
  const stripped = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return fail('invalid_json', 'Expected a complete strict JSON object without surrounding prose.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('invalid_structure', 'Root value must be a JSON object.')
  }
  const root = parsed as Record<string, unknown>
  if (!hasOnlyKeys(root, ROOT_KEYS)) {
    return fail('invalid_structure', 'Unknown root properties forbidden; no free-form text allowed.')
  }
  if (root.version !== 2) {
    return fail('invalid_structure', 'Only version=2 answerBlocks are accepted.')
  }
  const kind = root.kind
  if (kind !== 'answered' && kind !== 'clarification' && kind !== 'insufficient_data') {
    return fail('invalid_structure', 'kind must be answered | clarification | insufficient_data.')
  }
  const language = root.language === undefined ? 'zh' : root.language
  if (language !== 'zh' && language !== 'en') {
    return fail('invalid_structure', 'language must be zh or en.')
  }
  if (!Array.isArray(root.blocks) || root.blocks.length === 0 || root.blocks.length > 60) {
    return fail('invalid_structure', 'blocks must be a non-empty array (1..60 items).')
  }

  const en = language === 'en'
  const lines: string[] = []
  const cautions = new Set<string>()
  const facts: { runId: string; row: number; column: string; dimensions: string[] }[] = []
  const tableRunIds = new Set<string>()
  const usedRuns = new Set<string>()
  const resultOrder = [...views.keys()]
  let nonNoticeCount = 0
  let choiceCount = 0

  for (const item of root.blocks) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fail('invalid_structure', 'Each block must be a plain object.')
    }
    const block = item as Record<string, unknown>
    const type = block.type

    if (type === 'notice') {
      if (!hasOnlyKeys(block, NOTICE_KEYS) || typeof block.code !== 'string' || !(block.code in NOTICE_MESSAGES)) {
        return fail('invalid_structure', 'Invalid notice block.')
      }
      const msg = NOTICE_MESSAGES[block.code as NoticeCode][en ? 1 : 0]
      if (!lines.includes(msg)) lines.push(msg)
      cautions.add(msg)
      continue
    }

    if (type === 'metadata') {
      if (!hasOnlyKeys(block, META_KEYS) || typeof block.key !== 'string' || block.key.length === 0) {
        return fail('invalid_structure', 'Invalid metadata block.')
      }
      const value = metadata.get(block.key)
      if (value === undefined) {
        return fail('invalid_reference', `Metadata key "${block.key}" was not disclosed.`)
      }
      nonNoticeCount += 1
      lines.push(escapeValue(value))
      continue
    }

    if (type === 'choice') {
      if (!hasOnlyKeys(block, CHOICE_KEYS) || typeof block.key !== 'string' || !block.key.startsWith('choice:')) {
        return fail('invalid_reference', 'Choice block must reference a disclosed choice:* metadata key.')
      }
      if (kind !== 'clarification' || !metadata.has(block.key) || choiceCount >= 6) {
        return fail('invalid_reference', 'Choices are only permitted for clarification with disclosed keys (max 6).')
      }
      try {
        const parsedChoice = JSON.parse(metadata.get(block.key)!) as { label?: string; description?: string }
        if (!parsedChoice.label || !parsedChoice.description) {
          return fail('invalid_reference', 'Choice metadata is missing label or description.')
        }
        choiceCount += 1
        nonNoticeCount += 1
        lines.push(`${en ? 'Option' : '可选口径'}：${escapeValue(parsedChoice.label)} — ${escapeValue(parsedChoice.description)}`)
      } catch {
        return fail('invalid_reference', 'Invalid choice metadata JSON.')
      }
      continue
    }

    if (type === 'table') {
      if (!hasOnlyKeys(block, TABLE_KEYS) || typeof block.runId !== 'string') {
        return fail('invalid_structure', 'Invalid table block.')
      }
      const view = views.get(block.runId)
      if (!view || view.status !== 'succeeded') {
        return fail('invalid_reference', `Unknown or failed query runId "${block.runId}".`)
      }
      const ordinal = resultOrder.indexOf(block.runId) + 1
      usedRuns.add(block.runId)
      tableRunIds.add(block.runId)
      nonNoticeCount += 1
      lines.push(en ? `Result ${ordinal}: see table for ${escapeValue(view.assetName)}.` : `结果 ${ordinal}：请查看资产 ${escapeValue(view.assetName)} 的结果表。`)
      continue
    }

    if (type === 'fact') {
      if (!hasOnlyKeys(block, FACT_KEYS)) {
        return fail('invalid_structure', 'Fact block contains unknown fields (authored text/values forbidden).')
      }
      const runId = block.runId
      const rowIdx = block.row
      const column = block.column
      const dimensions = block.dimensions === undefined ? [] : block.dimensions
      const expect = block.expect === undefined ? 'any' : block.expect

      if (
        typeof runId !== 'string' ||
        typeof rowIdx !== 'number' ||
        !Number.isInteger(rowIdx) ||
        rowIdx < 0 ||
        typeof column !== 'string' ||
        column.length === 0 ||
        !Array.isArray(dimensions) ||
        dimensions.length > 8 ||
        !dimensions.every((d) => typeof d === 'string' && d.length > 0) ||
        typeof expect !== 'string' ||
        !EXPECT_VALUES.has(expect)
      ) {
        return fail('invalid_structure', 'Malformed fact block fields.')
      }

      const view = views.get(runId)
      if (!view || view.status !== 'succeeded') {
        return fail('invalid_reference', `Unknown or failed query runId "${runId}".`)
      }
      if (view.rowsWithheld === 'policy' || !view.rows || !view.rows[rowIdx]) {
        return fail('invalid_reference', `Row ${rowIdx} of runId "${runId}" is missing or withheld.`)
      }
      const row = view.rows[rowIdx]!
      const colIdx = view.columns.findIndex((c) => c.name === column)
      if (colIdx < 0 || view.columns.filter((c) => c.name === column).length !== 1 || colIdx >= row.length) {
        return fail('invalid_reference', `Column "${column}" is not a unique column in runId "${runId}".`)
      }
      const colMeta = view.columns[colIdx]!
      const val = row[colIdx]

      if (expect !== 'any') {
        const matched =
          expect === 'numeric'
            ? NUMERIC_TYPES.has(colMeta.type)
            : expect === 'date'
              ? colMeta.type === 'date' || colMeta.type === 'timestamp'
              : colMeta.type === expect
        if (!matched) {
          return fail('invalid_reference', `Column "${column}" has type "${colMeta.type}", incompatible with expect="${expect}".`)
        }
      }
      if (
        NUMERIC_TYPES.has(colMeta.type) &&
        val !== null &&
        val !== undefined &&
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(val))
      ) {
        return fail('invalid_reference', `Non-numeric value found in numeric column "${column}".`)
      }

      if (new Set([column, ...dimensions]).size !== dimensions.length + 1) {
        return fail('invalid_reference', 'Fact column and dimensions must be distinct.')
      }

      const cellTexts: string[] = []
      for (const fieldName of [column, ...dimensions]) {
        const idx = view.columns.findIndex((c) => c.name === fieldName)
        if (idx < 0 || idx >= row.length) {
          return fail('invalid_reference', `Dimension column "${fieldName}" does not exist in runId "${runId}".`)
        }
        const meta = view.columns[idx]!
        const rawCell = row[idx]
        const label = meta.label ?? meta.name
        const formatted =
          rawCell === null || rawCell === undefined
            ? en
              ? 'NULL (unknown / unavailable; not zero)'
              : 'NULL（未知或不可用，非零）'
            : escapeValue(rawCell)
        cellTexts.push(`${escapeValue(label)}：${formatted}${meta.unit ? ` ${escapeValue(meta.unit)}` : ''}`)
      }

      const ordinal = resultOrder.indexOf(runId) + 1
      usedRuns.add(runId)
      nonNoticeCount += 1
      facts.push({ runId, row: rowIdx, column, dimensions: [...dimensions] })
      lines.push(`${en ? 'Result' : '结果'} ${ordinal} · ${cellTexts.join('；')}`)
      continue
    }

    return fail('invalid_structure', `Unsupported block type "${String(type)}". Free text blocks are forbidden.`)
  }

  if (kind === 'answered' && nonNoticeCount === 0) {
    return fail('invalid_structure', 'answered must include at least one fact, table, or metadata block.')
  }
  if (choiceCount === 1) {
    return fail('invalid_structure', 'Clarification must offer at least 2 distinct definition choices.')
  }

  for (const runId of usedRuns) {
    const view = views.get(runId)!
    if (view.truncated || view.rowsWithheld === 'size') {
      const msg = en
        ? 'Bounded preview; do not infer whole-dataset totals or ranks.'
        : '结果已截断，不得据此推断全量合计或排名。'
      cautions.add(msg)
      lines.push(msg)
    }
    if (view.mode === 'explore') {
      cautions.add(en ? 'Exploratory query definition (unreviewed).' : '探索查询口径（未审核）。')
    }
    for (const c of view.caveats ?? []) cautions.add(escapeValue(c))
    for (const w of view.warnings ?? []) cautions.add(escapeValue(w))
  }

  const text = lines.join('\n\n')
  if (text.length > 20_000) {
    return fail('answer_too_long', 'Rendered answer exceeds 20,000 character delivery budget.')
  }

  return {
    ok: true,
    kind,
    text,
    facts,
    tableRunIds: [...tableRunIds],
    cautions: [...cautions],
  }
}
