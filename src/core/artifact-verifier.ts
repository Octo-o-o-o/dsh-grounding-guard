import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ArtifactCriterion, ArtifactVerificationResult } from './types.js'

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

/** Strict RFC-4180 CSV parser with zero external dependencies. */
export function parseStrictCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '')
  if (input.length === 0) return []
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }

    if (ch === '"' && cell.length === 0) {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i += 1
      continue
    }
    cell += ch
    i += 1
  }
  if (inQuotes) throw new Error('CSV_UNCLOSED_QUOTE')
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

function readConfinedFileSafe(rootPath: string, relativePath: string): { readonly bytes: Buffer; readonly sha256: string } {
  const realRoot = fs.realpathSync(rootPath)
  const resolved = path.resolve(realRoot, relativePath)
  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep
  if (!resolved.startsWith(rootPrefix)) {
    throw new Error('ARTIFACT_PATH_ESCAPE')
  }

  const preLstat = fs.lstatSync(resolved)
  if (preLstat.isSymbolicLink() || !preLstat.isFile()) {
    throw new Error('ARTIFACT_SYMLINK_OR_NONFILE')
  }
  if (fs.realpathSync(resolved) !== resolved) {
    throw new Error('ARTIFACT_SYMLINK_OR_NONFILE')
  }

  const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  const fd = fs.openSync(resolved, openFlags)
  try {
    const before = fs.fstatSync(fd)
    if (!before.isFile() || before.size > MAX_ARTIFACT_BYTES) {
      throw new Error('ARTIFACT_SIZE_LIMIT')
    }
    const bytes = fs.readFileSync(fd)
    const after = fs.fstatSync(fd)
    const current = fs.lstatSync(resolved)
    if (
      current.isSymbolicLink() ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error('ARTIFACT_CHANGED_DURING_CHECK')
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return { bytes, sha256 }
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Host-side deterministic artifact verifier. Checks symlink escape, TOCTOU
 * inode/mtime mutation, SHA-256, file size, and optional strict CSV columns/rows/sums.
 */
export function verifyArtifactDeterministic(
  rootPath: string,
  criterion: ArtifactCriterion,
): ArtifactVerificationResult {
  const checkedAt = new Date().toISOString()
  try {
    const { bytes, sha256 } = readConfinedFileSafe(rootPath, criterion.relativePath)

    if (criterion.expectedBytes !== undefined && bytes.byteLength !== criterion.expectedBytes) {
      return { status: 'unsupported', reason: 'ARTIFACT_SIZE_MISMATCH', sha256, bytes: bytes.byteLength, checkedAt }
    }
    if (criterion.expectedSha256 && criterion.expectedSha256.toLowerCase() !== sha256) {
      return { status: 'unsupported', reason: 'ARTIFACT_HASH_MISMATCH', sha256, bytes: bytes.byteLength, checkedAt }
    }

    if (criterion.kind === 'csv') {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const rows = parseStrictCsv(decoded)
      const header = rows[0]
      if (!header || header.length === 0) {
        return { status: 'unsupported', reason: 'CSV_EMPTY', sha256, bytes: bytes.byteLength, checkedAt }
      }
      if (criterion.columns) {
        if (JSON.stringify(header) !== JSON.stringify(criterion.columns) || new Set(header).size !== header.length) {
          return { status: 'unsupported', reason: 'CSV_COLUMNS_MISMATCH', sha256, bytes: bytes.byteLength, checkedAt }
        }
      }
      const dataRows = rows.slice(1)
      if (criterion.expectedRows !== undefined && dataRows.length !== criterion.expectedRows) {
        return { status: 'unsupported', reason: 'CSV_ROW_COUNT_MISMATCH', sha256, bytes: bytes.byteLength, checkedAt }
      }
      if (criterion.sums) {
        for (const [col, expectedSum] of Object.entries(criterion.sums)) {
          const colIdx = header.indexOf(col)
          if (colIdx < 0) {
            return { status: 'unsupported', reason: 'CSV_SUM_COLUMN_MISSING', sha256, bytes: bytes.byteLength, checkedAt }
          }
          let actualSum = 0
          for (const r of dataRows) {
            const rawCell = (r[colIdx] ?? '').trim()
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawCell)) {
              return { status: 'unsupported', reason: 'CSV_NON_NUMERIC_CELL', sha256, bytes: bytes.byteLength, checkedAt }
            }
            const num = Number(rawCell)
            if (!Number.isFinite(num)) {
              return { status: 'unsupported', reason: 'CSV_NON_FINITE_CELL', sha256, bytes: bytes.byteLength, checkedAt }
            }
            actualSum += num
          }
          const eps = Number.EPSILON * Math.max(1, Math.abs(expectedSum)) * Math.max(1, dataRows.length) * 16
          if (!Number.isFinite(actualSum) || Math.abs(actualSum - expectedSum) > eps) {
            return { status: 'unsupported', reason: 'CSV_SUM_MISMATCH', sha256, bytes: bytes.byteLength, checkedAt }
          }
        }
      }
    }

    return {
      status: 'supported',
      reason: 'Host verified physical artifact integrity and constraints',
      sha256,
      bytes: bytes.byteLength,
      checkedAt,
    }
  } catch (err) {
    const code = err instanceof Error && /^(?:ARTIFACT|CSV)_[A-Z_]+$/.test(err.message)
      ? err.message
      : 'ARTIFACT_UNREADABLE'
    return { status: 'unsupported', reason: code, checkedAt }
  }
}
