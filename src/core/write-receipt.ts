import { createHash } from 'node:crypto'
import type { WriteReceipt } from './types.js'

export const DEFAULT_WRITE_RECEIPT_TOOLS = new Set([
  'write_file',
  'edit_file',
  'patch_file',
  'apply_patch',
  'delete_file',
  'remove_file',
  'move_file',
  'copy_file',
  'mkdir',
  'save_file',
  'file_write',
  'file_edit',
  'replace_file_content',
  'multi_replace_file_content',
])

const SKIPPED_RECEIPT_KEYS = new Set([
  'content',
  'text',
  'data',
  'body',
  'raw',
  'rawContent',
  'fileContent',
  'stdout',
  'stderr',
])

const PATH_KEY_RE = /(^|_)(path|source|destination|outputPath|filePath|targetPath)$/i
const METRIC_KEY_RE = /(bytes|size|count|lines|operationCount|successCount|failCount|writtenBytes|replacedCount)$/i
const STATE_KEY_RE = /^(created|overwritten|deleted|copied|moved|dryRun|valid|appended)$/i
const HASH_KEY_RE = /^(sha256|contentHash|digest)$/i

function scrubReceiptString(input: string): string {
  return input
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/gi, '[REDACTED_SECRET]')
    .replace(/(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s"']+/g, '$1[USER]')
    .slice(0, 512)
}

export function isWriteReceiptTool(toolName: string, extraTools?: readonly string[]): boolean {
  const normalized = toolName.trim().toLowerCase()
  if (DEFAULT_WRITE_RECEIPT_TOOLS.has(normalized)) return true
  if (extraTools) {
    for (const item of extraTools) {
      if (item.trim().toLowerCase() === normalized) return true
    }
  }
  return false
}

export function buildWriteReceipt(
  toolName: string,
  rawResult: unknown,
  ok = true,
  argsHint?: unknown,
): WriteReceipt {
  const paths = new Set<string>()
  const metrics: Record<string, number> = {}
  const states: Record<string, boolean> = {}
  let sha256: string | undefined
  let errorKind: string | undefined
  let errorMessage: string | undefined

  const visit = (current: unknown, depth: number): void => {
    if (!current || depth > 5) return
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1)
      return
    }
    if (typeof current !== 'object') return

    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (SKIPPED_RECEIPT_KEYS.has(key)) {
        if (!sha256 && typeof child === 'string' && child.length > 0 && (key === 'content' || key === 'fileContent')) {
          sha256 = createHash('sha256').update(child).digest('hex')
        }
        continue
      }
      if (typeof child === 'string') {
        if (PATH_KEY_RE.test(key)) {
          paths.add(scrubReceiptString(child))
        } else if (HASH_KEY_RE.test(key) && /^[a-f0-9]{64}$/i.test(child)) {
          sha256 = child.toLowerCase()
        } else if (key === 'errorKind') {
          errorKind = child.slice(0, 64)
        } else if (!ok && (key === 'errorMessage' || key === 'message' || key === 'error')) {
          errorMessage = scrubReceiptString(child)
        }
        continue
      }
      if (typeof child === 'number' && Number.isFinite(child) && METRIC_KEY_RE.test(key)) {
        metrics[key] = child
        continue
      }
      if (typeof child === 'boolean' && STATE_KEY_RE.test(key)) {
        states[key] = child
        continue
      }
      visit(child, depth + 1)
    }
  }

  visit(argsHint, 0)
  visit(rawResult, 0)

  if (!ok && !errorMessage && typeof rawResult === 'string' && rawResult.trim().length > 0) {
    errorMessage = scrubReceiptString(rawResult.trim())
  }

  return {
    tool: toolName,
    ok,
    contentKind: 'receipt',
    paths: [...paths].sort(),
    metrics,
    states,
    ...(sha256 ? { sha256 } : {}),
    ...(errorKind ? { errorKind } : {}),
    ...(!ok ? { errorMessage: errorMessage ?? 'Tool write failed' } : {}),
  }
}
