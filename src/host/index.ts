/**
 * Official dsh@0.2.2-rc.5 Host entrypoint for `dsh-grounding-guard`.
 *
 * - Provides `governanceEvidence` Cordis service.
 * - Hooks `tools/post-execute` waterfall `(exec, result, next)` strictly honoring
 *   DSH's `PostToolDecision` (`accept` with `content` / `block` with `feedback` /
 *   `return next()`).
 * - Hooks `agent/turn-stopping` serial hook reading real DSH `assistant/message`
 *   stream/content from `agent.session.snapshotEvents()` (or mock `draft`) and
 *   steering with a valid DSH `UserMessage` at most `maxSteerCorrections` times.
 * - Persists verdicts as official ignorable plugin records
 *   (`plugin:dsh-grounding-guard/evidence-verdict`) via `@deepseek-ai/dsh-session`'s
 *   `appendPluginRecord()` so session resume & fork never break.
 * - Exposes authenticated `/api/dshGroundingGuard` matching DSH `serverResponseSchema`.
 */
import { createHash, randomUUID } from 'node:crypto'
import { containsUnquotedAbsoluteWording, findUnquotedAbsoluteWording } from '../core/absolute-wording.js'
import { verifyAndRenderAnswerBlocks } from '../core/answer-blocks.js'
import { verifyArtifactDeterministic } from '../core/artifact-verifier.js'
import { verifyTurnDeterministic } from '../core/quote-verifier.js'
import { buildWriteReceipt, isWriteReceiptTool } from '../core/write-receipt.js'
import { runFailClosedNliJudge, type LlmServiceLike } from './nli-judge.js'
import type {
  ArtifactCriterion,
  EvidenceRecord,
  EvidenceRecordInput,
  GovernanceEvidenceService,
  GroundingConfig,
  GroundingMode,
  QueryResultView,
  TurnVerificationReport,
  VerificationIssue,
  VerificationVerdict,
} from '../core/types.js'

export * from '../core/types.js'
export * from '../core/absolute-wording.js'
export * from '../core/answer-blocks.js'
export * from '../core/artifact-verifier.js'
export * from '../core/quote-verifier.js'
export * from '../core/write-receipt.js'
export { runFailClosedNliJudge, type LlmServiceLike } from './nli-judge.js'

export const VERDICT_SESSION_EVENT_TYPE = 'plugin:dsh-grounding-guard/evidence-verdict'
const LEGACY_VERDICT_EVENT_TYPE = 'governance/evidence-verdict'

const DEFAULT_MEMORY_TOOLS = new Set([
  'memory_save',
  'save_memory',
  'memory_write',
  'distill_memory',
  'update_memory',
  'upsert_memory',
  'add_memory',
])

const PASSIVE_READ_TOOLS = new Set([
  'read_file',
  'view_file',
  'grep_search',
  'search_web',
  'web_fetch',
  'fetch_url',
  'kb_read',
  'kb_search',
  'cat_file',
  'get_file',
])

type AppendPluginRecordFn = (session: unknown, type: string, data: unknown) => unknown
let cachedAppendPluginRecord: AppendPluginRecordFn | null | undefined

async function resolveAppendPluginRecord(): Promise<AppendPluginRecordFn | null> {
  if (cachedAppendPluginRecord !== undefined) return cachedAppendPluginRecord
  try {
    const specifier = '@deepseek-ai/dsh-session'
    const mod = (await import(specifier)) as { appendPluginRecord?: AppendPluginRecordFn }
    cachedAppendPluginRecord = typeof mod.appendPluginRecord === 'function' ? mod.appendPluginRecord : null
  } catch {
    cachedAppendPluginRecord = null
  }
  return cachedAppendPluginRecord
}

void resolveAppendPluginRecord()

interface OptionalAuditService {
  recordEvent?(input: Record<string, unknown>): unknown
}

interface OfficialHostConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void> | void
  }
}

interface CordisLikeContext {
  get(key: string): unknown
  provide?(key: string, value: unknown): void
  inject?(deps: readonly string[], callback: (ctx: CordisLikeContext) => void): () => void
  on?(event: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): () => void
  effect?(run: () => void | (() => void | Promise<void>), label?: string): void
}

export const name = 'dsh-grounding-guard'

function extractTextFromContentBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks) {
    if (typeof b === 'string') parts.push(b)
    else if (b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string') {
      parts.push((b as Record<string, unknown>).text as string)
    }
  }
  return parts.join('\n')
}

function extractTextFromAssistantEventData(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>

  // Real DSH `assistant/message` stores `stream: AssistantStreamRecord[]`
  if (Array.isArray(d.stream)) {
    const parts: string[] = []
    for (const rec of d.stream) {
      if (!rec || typeof rec !== 'object') continue
      const r = rec as Record<string, unknown>
      if (r.type === 'text-chunks' && Array.isArray(r.texts)) {
        for (const t of r.texts) if (typeof t === 'string') parts.push(t)
      } else if (r.type === 'chunk' && r.chunk && typeof r.chunk === 'object') {
        const chunk = r.chunk as Record<string, unknown>
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          parts.push(chunk.text)
        }
      }
    }
    if (parts.length > 0) return parts.join('')
  }

  // Fallback for content blocks or plain text
  if (Array.isArray(d.content)) {
    const t = extractTextFromContentBlocks(d.content)
    if (t) return t
  }
  if (typeof d.text === 'string') return d.text
  if (typeof d.content === 'string') return d.content
  return ''
}

function extractLatestAssistantTextFromSession(session: any): string {
  if (!session) return ''
  const events: readonly any[] =
    typeof session.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : Array.isArray(session.events)
        ? session.events
        : []
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev?.type === 'assistant/message') {
      const text = extractTextFromAssistantEventData(ev.data ?? ev.payload)
      if (text.trim().length > 0) return text
    }
  }
  return ''
}

function extractTextFromUnknown(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((v) => extractTextFromUnknown(v, depth + 1)).filter(Boolean).join('\n')
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.value !== undefined && typeof obj.value === 'object') {
      const fromVal = extractTextFromUnknown(obj.value, depth + 1)
      if (fromVal) return fromVal
    }
    if (Array.isArray(obj.content)) {
      const fromBlocks = extractTextFromContentBlocks(obj.content)
      if (fromBlocks) return fromBlocks
    }
    for (const k of ['text', 'content', 'draft', 'message', 'body', 'excerpt', 'output', 'note', 'summary']) {
      if (typeof obj[k] === 'string' && (obj[k] as string).length > 0) return obj[k] as string
    }
    if (Array.isArray(obj.parts)) return extractTextFromUnknown(obj.parts, depth + 1)
  }
  return ''
}

function resolveSessionContext(payload: Record<string, unknown>, boundThis?: unknown): { id: string; raw?: any; agent?: any } {
  const agent = (payload?.agent ?? (boundThis && typeof boundThis === 'object' && 'session' in (boundThis as object) ? boundThis : undefined)) as
    | { session?: { id?: string; snapshotEvents?: () => readonly any[]; events?: readonly any[]; append?: (t: string, d: unknown) => unknown }; steer?: (msg: any) => void | Promise<void> }
    | undefined
  const sess = (payload?.session as typeof agent extends { session?: infer S } ? S : any) ?? agent?.session
  if (sess && typeof sess.id === 'string') return { id: sess.id, raw: sess, agent }
  if (typeof payload?.sessionId === 'string') return { id: payload.sessionId, raw: sess, agent }
  return { id: 'default-session', raw: sess, agent }
}

function isMemoryTool(toolName: string, extra?: readonly string[]): boolean {
  const lower = toolName.trim().toLowerCase()
  if (DEFAULT_MEMORY_TOOLS.has(lower)) return true
  if (extra) {
    for (const t of extra) if (t.trim().toLowerCase() === lower) return true
  }
  return false
}

export function apply(ctx: CordisLikeContext, config: GroundingConfig = {}): GovernanceEvidenceService {
  let mode: GroundingMode = config.mode ?? 'enforce'
  const maxSteerCorrections = Math.max(0, config.maxSteerCorrections ?? 1)
  const enableWriteReceiptFlowback = config.enableWriteReceiptFlowback ?? true
  let enableNliStage2 = config.enableNliStage2 ?? false
  const nliPurpose = config.nliPurpose ?? 'grounding-verify'
  const nliTimeoutMs = config.nliTimeoutMs ?? 12_000
  const enableAbsoluteWordingGuard = config.enableAbsoluteWordingGuard ?? true

  const evidenceBySession = new Map<string, EvidenceRecord[]>()
  const queryViewsBySession = new Map<string, Map<string, QueryResultView>>()
  const verdictsBySession = new Map<string, TurnVerificationReport[]>()
  const steerCountsByTurn = new Map<string, number>()

  const recordAudit = (input: Record<string, unknown>) => {
    const audit = ctx.get('governanceAudit') as OptionalAuditService | undefined
    try {
      audit?.recordEvent?.(input)
    } catch {
      /* audit is optional */
    }
  }

  const registerEvidence = (input: EvidenceRecordInput): EvidenceRecord => {
    const list = evidenceBySession.get(input.sessionId) ?? []
    const contentForHash = input.fullText ?? input.excerpt
    const sha256 = input.sha256 ?? createHash('sha256').update(contentForHash).digest('hex')

    const existing = list.find(
      (e) =>
        e.locator === input.locator &&
        e.sha256 === sha256 &&
        e.truncated === Boolean(input.truncated) &&
        e.nextOffset === input.nextOffset,
    )
    if (existing) return existing

    const truncated = Boolean(input.truncated)
    const auditability =
      input.auditability ??
      (input.sourceType === 'web'
        ? 'unverified'
        : truncated
          ? 'partial'
          : 'auditable')

    const record: EvidenceRecord = {
      id: input.id ?? `ev-${list.length + 1}-${sha256.slice(0, 8)}`,
      sessionId: input.sessionId,
      sourceType: input.sourceType,
      locator: input.locator,
      title: input.title,
      excerpt: input.excerpt.slice(0, 4_000),
      fullText: input.fullText ? input.fullText.slice(0, 65_536) : undefined,
      sha256,
      bytes: input.bytes,
      truncated,
      nextOffset: input.nextOffset,
      totalBytes: input.totalBytes,
      lineStart: input.lineStart,
      lineEnd: input.lineEnd,
      auditability,
      capturedAt: new Date().toISOString(),
    }

    list.push(record)
    if (list.length > 250) list.shift()
    evidenceBySession.set(input.sessionId, list)
    return record
  }

  const verifyTurnTextInternal = async (
    sessionId: string,
    text: string,
    opts?: { runNli?: boolean; turnKey?: string },
  ): Promise<TurnVerificationReport> => {
    const evidenceList = evidenceBySession.get(sessionId) ?? []
    const stage1 = verifyTurnDeterministic(text, evidenceList)
    const issues: VerificationIssue[] = [...stage1.issues]
    let verdict: VerificationVerdict = stage1.verdict
    let nliUsed = false

    const shouldRunNli = opts?.runNli ?? enableNliStage2
    if (shouldRunNli && stage1.citedPairs.length > 0 && verdict !== 'contradicted') {
      nliUsed = true
      const llm = ctx.get('llm') as LlmServiceLike | undefined
      for (const pair of stage1.citedPairs.slice(0, 6)) {
        const res = await runFailClosedNliJudge(llm, pair.sentence, pair.quote, {
          purpose: nliPurpose,
          timeoutMs: nliTimeoutMs,
        })
        if (res.verdict === 'contradicted') {
          issues.push({
            code: 'NLI_CONTRADICTED',
            severity: 'error',
            citationId: pair.citationId,
            locator: pair.evidence.locator,
            message: `Independent NLI judge found contradiction: ${res.reason}`,
          })
          verdict = 'contradicted'
        } else if (res.verdict === 'unsupported') {
          issues.push({
            code: 'NLI_UNSUPPORTED',
            severity: 'error',
            citationId: pair.citationId,
            locator: pair.evidence.locator,
            message: `Independent NLI judge found claim unsupported: ${res.reason}`,
          })
          if (verdict !== 'contradicted') verdict = 'unverified'
        } else if (res.verdict === 'partial') {
          issues.push({
            code: 'NLI_PARTIAL',
            severity: 'warn',
            citationId: pair.citationId,
            locator: pair.evidence.locator,
            message: `Independent NLI judge found partial support: ${res.reason}`,
          })
          if (verdict === 'verified') verdict = 'partial'
        } else if (res.verdict === 'unverified') {
          issues.push({
            code: 'NLI_UNAVAILABLE',
            severity: 'warn',
            citationId: pair.citationId,
            locator: pair.evidence.locator,
            message: res.reason,
          })
          if (verdict === 'verified' || verdict === 'partial') verdict = 'unverified'
        }
      }
    }

    return {
      id: randomUUID(),
      sessionId,
      turnKey: opts?.turnKey ?? `${sessionId}:${Date.now()}`,
      verdict,
      issues,
      citedEvidenceIds: stage1.citedEvidenceIds,
      totalEvidenceCount: evidenceList.length,
      nliUsed,
      steered: false,
      createdAt: new Date().toISOString(),
    }
  }

  const persistVerdictToSession = async (report: TurnVerificationReport, rawSession?: any) => {
    if (!rawSession) return
    if (typeof rawSession.snapshotEvents === 'function') {
      // Real DSH Session -> use ignorable plugin record so persistence always resumes cleanly!
      const appendFn = (await resolveAppendPluginRecord()) ?? cachedAppendPluginRecord
      if (typeof appendFn === 'function') {
        try {
          appendFn(rawSession, VERDICT_SESSION_EVENT_TYPE, report)
        } catch {
          /* ignore detached/closed session */
        }
      }
    } else if (typeof rawSession.append === 'function') {
      try {
        rawSession.append(VERDICT_SESSION_EVENT_TYPE, report)
      } catch {
        /* ignore mock error */
      }
    }
  }

  const pushVerdict = async (report: TurnVerificationReport, rawSession?: any) => {
    const arr = verdictsBySession.get(report.sessionId) ?? []
    arr.push(report)
    if (arr.length > 100) arr.shift()
    verdictsBySession.set(report.sessionId, arr)

    await persistVerdictToSession(report, rawSession)
    recordAudit({
      stream: 'governance',
      eventName: 'grounding.turn_verified',
      actorType: 'system',
      actorId: 'dsh-grounding-guard',
      resourceType: 'session_turn',
      resourceId: report.turnKey,
      outcome: report.verdict === 'contradicted' ? 'denied' : 'success',
      sessionId: report.sessionId,
      payload: {
        verdict: report.verdict,
        issueCodes: report.issues.map((i) => i.code),
        citedCount: report.citedEvidenceIds.length,
        nliUsed: report.nliUsed,
        steered: report.steered,
      },
    })
  }

  const service: GovernanceEvidenceService = {
    registerEvidence,
    listEvidence: (sessionId?: string) => {
      if (sessionId) return [...(evidenceBySession.get(sessionId) ?? [])]
      return [...evidenceBySession.values()].flat()
    },
    clearSession: (sessionId: string) => {
      evidenceBySession.delete(sessionId)
      queryViewsBySession.delete(sessionId)
      verdictsBySession.delete(sessionId)
    },
    registerQueryView: (sessionId: string, view: QueryResultView) => {
      const m = queryViewsBySession.get(sessionId) ?? new Map<string, QueryResultView>()
      m.set(view.runId, view)
      queryViewsBySession.set(sessionId, m)
    },
    listQueryViews: (sessionId: string) => [...(queryViewsBySession.get(sessionId)?.values() ?? [])],
    normalizeWriteResult: (toolName: string, rawResult: unknown, ok = true) =>
      buildWriteReceipt(toolName, rawResult, ok),
    verifyTurnText: (sessionId: string, text: string, opts?: { runNli?: boolean }) =>
      verifyTurnTextInternal(sessionId, text, opts),
    verifyAnswerBlocks: (rawJson, views, metadata) => verifyAndRenderAnswerBlocks(rawJson, views, metadata),
    verifyArtifact: (rootPath: string, criterion: ArtifactCriterion) => verifyArtifactDeterministic(rootPath, criterion),
    checkAbsoluteWording: (text) => {
      const matches = findUnquotedAbsoluteWording(text)
      return { flagged: matches.length > 0, matches }
    },
    listVerdicts: (sessionId?: string) => {
      if (sessionId) return [...(verdictsBySession.get(sessionId) ?? [])]
      return [...verdictsBySession.values()].flat()
    },
    getConfig: () => ({
      mode,
      maxSteerCorrections,
      enableWriteReceiptFlowback,
      enableNliStage2,
      nliPurpose,
      nliTimeoutMs,
      enableAbsoluteWordingGuard,
    }),
    setNliEnabled: (enabled: boolean) => {
      enableNliStage2 = Boolean(enabled)
    },
    setMode: (next: GroundingMode) => {
      mode = next
    },
  }

  ctx.provide?.('governanceEvidence', service)

  // Rehydrate persisted verdicts when sessions are resumed/forked
  const disposeSessCreated = ctx.on?.('session/created', (session: any) => {
    if (!session || typeof session.id !== 'string') return
    const events: readonly any[] =
      typeof session.snapshotEvents === 'function'
        ? session.snapshotEvents()
        : Array.isArray(session.events)
          ? session.events
          : []
    const restored: TurnVerificationReport[] = []
    for (const ev of events) {
      if ((ev?.type === VERDICT_SESSION_EVENT_TYPE || ev?.type === LEGACY_VERDICT_EVENT_TYPE) && ev.data) {
        restored.push(ev.data as TurnVerificationReport)
      }
    }
    if (restored.length > 0) {
      verdictsBySession.set(session.id, restored.slice(-100))
    }
  })

  // Hook 1: Official DSH `tools/post-execute` WATERFALL `(exec, result, next)`
  const disposePostExec = ctx.on?.(
    'tools/post-execute',
    async (exec: Record<string, unknown>, rawResult: unknown, next?: () => Promise<unknown>) => {
      const toolName = String(exec?.name ?? exec?.toolName ?? '')
      const args = exec?.arguments ?? exec?.args
      const { id: sessionId } = resolveSessionContext(exec)
      const resObj = rawResult && typeof rawResult === 'object' ? (rawResult as Record<string, unknown>) : undefined
      const payloadObj =
        resObj && resObj.value && typeof resObj.value === 'object'
          ? (resObj.value as Record<string, unknown>)
          : resObj

      // 1a. Block unquoted absolute generalizations on memory-write tools
      if (enableAbsoluteWordingGuard && isMemoryTool(toolName, config.memoryTools)) {
        const textToInspect = extractTextFromUnknown(args) || extractTextFromUnknown(rawResult)
        if (containsUnquotedAbsoluteWording(textToInspect)) {
          const hits = findUnquotedAbsoluteWording(textToInspect)
          const reason = `Memory distillation blocked by absoluteWordingGuard (unquoted absolute terms: ${[...new Set(hits)].slice(0, 4).join(', ')}). Drop or cite exact user quote.`
          recordAudit({
            stream: 'governance',
            eventName: 'grounding.absolute_wording_blocked',
            actorType: 'agent',
            actorId: sessionId,
            resourceType: 'memory_write',
            resourceId: toolName,
            outcome: 'denied',
            sessionId,
            payload: { hits: hits.slice(0, 5) },
          })
          return {
            kind: 'block',
            feedback: [{ type: 'text', text: reason }],
            info: {
              name: 'AbsoluteWordingBlockedError',
              code: 'ABSOLUTE_WORDING_BLOCKED',
              reason,
            },
          }
        }
      }

      // 1b. Write-tool receipt convergence (DSH `accept` with compact receipt ContentBlock, stripping raw body echo)
      if (enableWriteReceiptFlowback && isWriteReceiptTool(toolName, config.writeTools)) {
        const alreadyReceipt = payloadObj?.contentKind === 'receipt'
        if (!alreadyReceipt) {
          const okFlag =
            typeof resObj?.isError === 'boolean'
              ? !resObj.isError
              : typeof payloadObj?.ok === 'boolean'
                ? Boolean(payloadObj.ok)
                : true
          const receipt = buildWriteReceipt(toolName, payloadObj ?? rawResult, okFlag, args)
          return {
            kind: 'accept',
            content: [{ type: 'text', text: JSON.stringify(receipt) }],
          }
        }
      }

      // 1c. Passive evidence & truncation capture from read/search tools
      if (PASSIVE_READ_TOOLS.has(toolName.trim().toLowerCase()) && !resObj?.isError) {
        const argsObj = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined
        const content = extractTextFromUnknown(payloadObj ?? rawResult)
        if (content.length > 0) {
          const locator = String(
            payloadObj?.locator ??
              payloadObj?.relPath ??
              payloadObj?.path ??
              argsObj?.path ??
              argsObj?.filePath ??
              argsObj?.url ??
              argsObj?.query ??
              toolName,
          )
          const truncated = Boolean(payloadObj?.truncated)
          const nextOffset = typeof payloadObj?.nextOffset === 'number' ? payloadObj.nextOffset : undefined
          const sourceType =
            toolName.includes('web') || toolName.includes('fetch')
              ? 'web'
              : toolName.startsWith('kb_')
                ? 'kb'
                : 'file'
          registerEvidence({
            sessionId,
            sourceType,
            locator,
            excerpt: content.slice(0, 2_000),
            fullText: content,
            truncated,
            nextOffset,
            bytes: typeof payloadObj?.bytes === 'number' ? payloadObj.bytes : Buffer.byteLength(content, 'utf8'),
          })
        }
      }

      // CRITICAL: always continue DSH waterfall when not intercepting!
      return typeof next === 'function' ? next() : { kind: 'accept' }
    },
  )

  // Hook 2: Official DSH `agent/turn-stopping` serial hook (`function(this: Agent, { agent, turn, signal })`)
  const disposeTurnStop = ctx.on?.('agent/turn-stopping', async function (this: unknown, event: Record<string, unknown>) {
    const { id: sessionId, raw: rawSession, agent } = resolveSessionContext(event ?? {}, this)
    const draftText =
      extractTextFromUnknown(event?.draft ?? event?.text ?? event?.message ?? event?.response) ||
      extractLatestAssistantTextFromSession(rawSession)
    if (!draftText.trim()) return undefined

    const turnNumber = typeof event?.turn === 'number' ? event.turn : event?.turnIndex ?? 0
    const turnKey = String(event?.turnId ?? event?.turnKey ?? `${sessionId}:turn-${turnNumber}`)
    const report = await verifyTurnTextInternal(sessionId, draftText, { turnKey })

    const blockingIssues = report.issues.filter((i) => i.severity === 'error')
    const currentSteers = steerCountsByTurn.get(turnKey) ?? 0

    if (
      mode === 'enforce' &&
      blockingIssues.length > 0 &&
      currentSteers < maxSteerCorrections &&
      typeof agent?.steer === 'function'
    ) {
      steerCountsByTurn.set(turnKey, currentSteers + 1)
      const steeredReport: TurnVerificationReport = { ...report, steered: true }
      await pushVerdict(steeredReport, rawSession)
      const reasons = blockingIssues.map((i) => `- [${i.code}] ${i.message}`).join('\n')
      const correctionText = `[dsh-grounding-guard] Grounding verification failed (${blockingIssues.length} issue(s)). Fix the response using only verified evidence or state uncertainty explicitly:\n${reasons}`
      // Official DSH `Agent.steer(UserMessage)` contract!
      await agent.steer({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: correctionText }],
        source: { kind: 'user' },
      })
      return steeredReport
    }

    await pushVerdict(report, rawSession)
    return report
  })

  // Authenticated Host RPC: /api/dshGroundingGuard (matches official DSH Connection RPC envelope)
  let disposeRoute: (() => Promise<void> | void) | undefined
  const registerConnectionRoute = (connection: OfficialHostConnection): (() => Promise<void> | void) | undefined => {
    if (!connection?.fetch?.register) return undefined
    return connection.fetch.register({
      path: '/api/dshGroundingGuard',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return new Response('body is not JSON', { status: 400 })
        }
        const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : '00000000-0000-0000-0000-000000000000'
        const isDshEnvelope = body?.type === 'client-request' && body?.payload && typeof body.payload === 'object'
        const envelope = (isDshEnvelope ? body.payload : body) as { method?: unknown; payload?: Record<string, unknown> }
        const method = typeof envelope.method === 'string' ? envelope.method : 'status'
        const payload = (envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {}) as Record<string, unknown>

        const dispatch = async (): Promise<
          { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }
        > => {
          try {
            if (method === 'status') {
              return {
                ok: true,
                value: {
                  config: service.getConfig(),
                  evidenceCount: service.listEvidence().length,
                  verdictCount: service.listVerdicts().length,
                },
              }
            }
            if (method === 'listEvidence') {
              return {
                ok: true,
                value: {
                  items: service.listEvidence(typeof payload.sessionId === 'string' ? payload.sessionId : undefined),
                },
              }
            }
            if (method === 'listVerdicts') {
              return {
                ok: true,
                value: {
                  items: service
                    .listVerdicts(typeof payload.sessionId === 'string' ? payload.sessionId : undefined)
                    .slice(-50)
                    .reverse(),
                },
              }
            }
            if (method === 'setNliEnabled') {
              service.setNliEnabled(Boolean(payload.enabled))
              return { ok: true, value: { config: service.getConfig() } }
            }
            if (method === 'setMode') {
              const next = payload.mode === 'observe' ? 'observe' : 'enforce'
              service.setMode(next)
              return { ok: true, value: { config: service.getConfig() } }
            }
            if (method === 'verifyText') {
              const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : 'default-session'
              const text = typeof payload.text === 'string' ? payload.text : ''
              const verified = await service.verifyTurnText(sessionId, text, {
                runNli: typeof payload.runNli === 'boolean' ? payload.runNli : undefined,
              })
              return { ok: true, value: verified }
            }
            return {
              ok: false,
              error: { code: 'dsh-grounding-guard/not-found', message: `Unknown method: ${method}`, details: {} },
            }
          } catch (err) {
            return {
              ok: false,
              error: {
                code: 'dsh-grounding-guard/error',
                message: err instanceof Error ? err.message : String(err),
                details: {},
              },
            }
          }
        }

        return Response.json({ type: 'server-response', rpcId, result: await dispatch() })
      },
    })
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (scope) => {
      const conn = scope.get('connection') as OfficialHostConnection | undefined
      if (!conn) return
      const disposer = registerConnectionRoute(conn)
      if (disposer) scope.effect?.(() => disposer, 'dsh-grounding-guard: connection route')
    })
  } else {
    const conn = ctx.get('connection') as OfficialHostConnection | undefined
    if (conn) disposeRoute = registerConnectionRoute(conn)
  }

  ctx.effect?.(() => {
    return async () => {
      disposeSessCreated?.()
      disposePostExec?.()
      disposeTurnStop?.()
      await disposeRoute?.()
    }
  }, 'dsh-grounding-guard: cleanup')

  return service
}
