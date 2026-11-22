import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  containsUnquotedAbsoluteWording,
  locateQuoteInSource,
  verifyAndRenderAnswerBlocks,
  verifyArtifactDeterministic,
  type QueryResultView,
} from '../src/host/index.js'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function createMockCtx(overrides?: { llm?: unknown }) {
  const provided = new Map<string, unknown>()
  const listeners = new Map<string, ((...args: any[]) => any)[]>()
  const routes = new Map<string, (req: Request) => Promise<Response>>()
  const auditEvents: Record<string, unknown>[] = []

  const ctx = {
    get(key: string) {
      if (key === 'governanceAudit') {
        return { recordEvent: (ev: Record<string, unknown>) => auditEvents.push(ev) }
      }
      if (key === 'llm') return overrides?.llm
      if (key === 'connection') {
        return {
          fetch: {
            register: (route: { path: string; fetch: (req: Request) => Promise<Response> }) => {
              routes.set(route.path, route.fetch)
              return () => routes.delete(route.path)
            },
          },
        }
      }
      return undefined
    },
    provide(key: string, value: unknown) {
      provided.set(key, value)
    },
    on(event: string, listener: (...args: any[]) => any) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((fn) => fn !== listener),
        )
      }
    },
    effect() {},
  }

  return { ctx, provided, listeners, routes, auditEvents }
}

describe('dsh-grounding-guard', () => {
  it('verifies exact and whitespace-normalized quotes and rejects fabricated citations', async () => {
    const { ctx } = createMockCtx()
    const svc = apply(ctx)
    const ev = svc.registerEvidence({
      sessionId: 'sess-1',
      sourceType: 'file',
      locator: 'contracts/sla.md',
      excerpt: 'Penalty rate is 0.5% per delayed business day.',
      fullText: 'Clause 7:\nPenalty rate is   0.5% per\ndelayed business day.\nMax cap 10%.',
    })

    const loc = locateQuoteInSource(ev.fullText!, 'Penalty rate is 0.5% per delayed business day.')
    expect(loc.matched).toBe(true)
    expect(loc.matchKind).toBe('normalized')
    expect(loc.lineStart).toBe(2)

    const good = await svc.verifyTurnText(
      'sess-1',
      `According to SLA, "Penalty rate is 0.5% per delayed business day." [ev:${ev.id}]`,
    )
    expect(good.verdict).toBe('verified')

    const tamperedQuote = await svc.verifyTurnText(
      'sess-1',
      `According to SLA, "Penalty rate is 5.0% per delayed business day." [ev:${ev.id}]`,
    )
    expect(tamperedQuote.verdict).toBe('contradicted')
    expect(tamperedQuote.issues.some((i) => i.code === 'QUOTE_NOT_LOCATED')).toBe(true)

    const fakeCite = await svc.verifyTurnText('sess-1', 'Contract says 99% [ev:ghost-id].')
    expect(fakeCite.verdict).toBe('contradicted')
    expect(fakeCite.issues.some((i) => i.code === 'FABRICATED_CITATION')).toBe(true)
  })

  it('catches exhaustive claims on truncated reads and bounds agent.steer retries to 1', async () => {
    const { ctx, listeners } = createMockCtx()
    apply(ctx, { maxSteerCorrections: 1 })

    const postExec = listeners.get('tools/post-execute')![0]!
    const turnStop = listeners.get('agent/turn-stopping')![0]!

    // Passive capture of truncated read
    postExec(
      { toolName: 'read_file', sessionId: 'sess-trunc', args: { path: 'big.log' } },
      { text: 'line 1\nline 2\n', truncated: true, nextOffset: 4096 },
    )

    const steerCalls: string[] = []
    const sessionEvents: { type: string; data: unknown }[] = []
    const mockEvent = {
      sessionId: 'sess-trunc',
      turnId: 'turn-42',
      session: {
        id: 'sess-trunc',
        append: (type: string, data: unknown) => sessionEvents.push({ type, data }),
      },
      agent: {
        steer: (msg: string) => steerCalls.push(msg),
      },
      draft: '经核查，全文未找到任何错误记录。',
    }

    // Attempt 1 -> triggers 1 steer correction
    const first = await turnStop(mockEvent)
    expect(first.verdict).toBe('contradicted')
    expect(first.steered).toBe(true)
    expect(steerCalls).toHaveLength(1)
    expect(steerCalls[0]).toContain('TRUNCATED_EXHAUSTIVE_CLAIM')

    // Attempt 2 on same turnId -> MUST NOT loop infinitely; persists honest verdict
    const second = await turnStop(mockEvent)
    expect(second.verdict).toBe('contradicted')
    expect(second.steered).toBe(false)
    expect(steerCalls).toHaveLength(1)
    expect(sessionEvents).toHaveLength(2)
    expect(sessionEvents[0]!.type).toBe('governance/evidence-verdict')

    // Honest partial acknowledgment passes without truncation error
    const third = await turnStop({
      ...mockEvent,
      turnId: 'turn-43',
      draft: '注意：该文件读取已截断（仅读取前 4096 字节），在已读片段中未见错误记录。',
    })
    expect(third.issues.some((i: { code: string }) => i.code === 'TRUNCATED_EXHAUSTIVE_CLAIM')).toBe(false)
  })

  it('enforces strict v2 answerBlocks with zero model-authored numbers', () => {
    const view: QueryResultView = {
      runId: 'q-100',
      status: 'succeeded',
      assetName: 'orders_2026',
      mode: 'template',
      dataAsOf: '2026-11-22',
      columns: [
        { name: 'region', type: 'text', label: '区域', role: 'dimension' },
        { name: 'revenue', type: 'decimal', label: '营收', unit: '万元', role: 'measure' },
      ],
      rows: [
        ['华东', 1280.5],
        ['华南', 940.25],
      ],
    }
    const views = new Map([[view.runId, view]])

    const validJson = JSON.stringify({
      version: 2,
      kind: 'answered',
      language: 'zh',
      blocks: [
        { type: 'fact', runId: 'q-100', row: 0, column: 'revenue', dimensions: ['region'], expect: 'numeric' },
      ],
    })
    const ok = verifyAndRenderAnswerBlocks(validJson, views)
    expect(ok.ok).toBe(true)
    expect(ok.text).toContain('1280.5 万元')
    expect(ok.text).toContain('华东')

    // Free-form text block or model-authored number MUST be rejected
    const hallucinated = JSON.stringify({
      version: 2,
      kind: 'answered',
      language: 'zh',
      blocks: [{ type: 'text', value: '华东营收 99999 万元' }],
    })
    const bad = verifyAndRenderAnswerBlocks(hallucinated, views)
    expect(bad.ok).toBe(false)
    expect(bad.code).toBe('invalid_structure')

    // Out-of-bounds row MUST be rejected
    const badRow = JSON.stringify({
      version: 2,
      kind: 'answered',
      language: 'zh',
      blocks: [{ type: 'fact', runId: 'q-100', row: 9, column: 'revenue', expect: 'numeric' }],
    })
    expect(verifyAndRenderAnswerBlocks(badRow, views).ok).toBe(false)
  })

  it('converges write-tool outputs into compact WriteReceipts without body echo', () => {
    const { ctx, listeners } = createMockCtx()
    apply(ctx)
    const postExec = listeners.get('tools/post-execute')![0]!

    const out = postExec(
      {
        toolName: 'write_file',
        sessionId: 's-w',
        args: { path: 'C:\\Users\\alice\\project\\report.md', content: 'TOP SECRET BODY sk-1234567890abcdef' },
      },
      { ok: true, bytes: 36, created: true, content: 'TOP SECRET BODY sk-1234567890abcdef' },
    )
    expect(out?.kind).toBe('replace')
    expect(out.result.contentKind).toBe('receipt')
    expect(out.result.metrics.bytes).toBe(36)
    expect(out.result.states.created).toBe(true)
    expect(out.result.sha256).toHaveLength(64)
    expect(JSON.stringify(out.result)).not.toContain('TOP SECRET BODY')
    expect(JSON.stringify(out.result)).not.toContain('alice')
  })

  it('verifies host physical artifacts (SHA-256 + strict CSV sums) and blocks path traversal', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-grounding-'))
    tempDirs.push(dir)
    const csvContent = 'item,amount\nalpha,10.5\nbeta,20.25\n'
    writeFileSync(path.join(dir, 'summary.csv'), csvContent, 'utf8')
    const expectedSha256 = createHash('sha256').update(csvContent).digest('hex')

    const pass = verifyArtifactDeterministic(dir, {
      kind: 'csv',
      relativePath: 'summary.csv',
      expectedSha256,
      columns: ['item', 'amount'],
      expectedRows: 2,
      sums: { amount: 30.75 },
    })
    expect(pass.status).toBe('supported')

    const wrongSum = verifyArtifactDeterministic(dir, {
      kind: 'csv',
      relativePath: 'summary.csv',
      columns: ['item', 'amount'],
      expectedRows: 2,
      sums: { amount: 999 },
    })
    expect(wrongSum.status).toBe('unsupported')
    expect(wrongSum.reason).toBe('CSV_SUM_MISMATCH')

    const escape = verifyArtifactDeterministic(dir, {
      kind: 'file',
      relativePath: '../escape.txt',
    })
    expect(escape.status).toBe('unsupported')
    expect(escape.reason).toBe('ARTIFACT_PATH_ESCAPE')
  })

  it('enforces absoluteWordingGuard with quote/negation exemptions and blocks memory writes', () => {
    expect(containsUnquotedAbsoluteWording('用户总是喜欢深色模式')).toBe(true)
    expect(containsUnquotedAbsoluteWording('User is an expert in Rust')).toBe(true)
    expect(containsUnquotedAbsoluteWording('用户说“我总是用深色模式”')).toBe(false)
    expect(containsUnquotedAbsoluteWording('并不总是需要开启')).toBe(false)
    expect(containsUnquotedAbsoluteWording('This is not always true')).toBe(false)

    const { ctx, listeners } = createMockCtx()
    apply(ctx)
    const postExec = listeners.get('tools/post-execute')![0]!
    const blocked = postExec(
      { toolName: 'memory_save', sessionId: 's-m', args: { content: '用户一定拒绝所有英文文档' } },
      { ok: true },
    )
    expect(blocked?.kind).toBe('block')
  })

  it('fails closed to unverified when Stage 2 NLI judge errors or is unavailable', async () => {
    const failingLlm = {
      generateText: async () => {
        throw new Error('upstream 503')
      },
    }
    const { ctx } = createMockCtx({ llm: failingLlm })
    const svc = apply(ctx, { enableNliStage2: true })
    const ev = svc.registerEvidence({
      sessionId: 's-nli',
      sourceType: 'file',
      locator: 'policy.md',
      excerpt: 'Retention is 365 days.',
      fullText: 'Retention is 365 days.',
    })

    const rep = await svc.verifyTurnText('s-nli', `Policy states "Retention is 365 days." [ev:${ev.id}]`)
    expect(rep.nliUsed).toBe(true)
    // Stage 1 would have passed, but Stage 2 NLI failed -> MUST fail-closed to unverified!
    expect(rep.verdict).toBe('unverified')
    expect(rep.issues.some((i) => i.code === 'NLI_UNAVAILABLE')).toBe(true)
  })
})
