/**
 * Official dsh@0.2.2-rc.5 Host entrypoint for `dsh-grounding-guard`.
 *
 * Provides `governanceEvidence` service, passive read/truncation capture + write
 * receipt convergence + memory absolute-wording blocking on `tools/post-execute`,
 * and Stage 1 deterministic + optional Stage 2 fail-closed NLI verification with
 * bounded `agent.steer` self-correction on `agent/turn-stopping`.
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

export const VERDICT_SESSION_EVENT_TYPE = 'governance/evidence-verdict'

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

interface OptionalAuditService {
  recordEvent?(input: Record<string, unknown>): unknown
}

interface SessionProjectionsLike {
  register?(def: {
    readonly key: string
    readonly initial: () => unknown
    readonly reduce: (state: any, event: { type?: string; data?: unknown }) => unknown
  }): () => void
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
  on?(event: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): () => void
  effect?(run: () => void | (() => void | Promise<void>), label?: string): void
}

export const name = 'dsh-grounding-guard'
export const inject = { optional: ['connection', 'tools', 'sessions', 'sessionProjections', 'llm'] }

function extractTextFromUnknown(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((v) => extractTextFromUnknown(v, depth + 1)).filter(Boolean).join('\n')
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const k of ['text', 'content', 'draft', 'message', 'body', 'excerpt', 'output', 'note', 'summary']) {
      if (typeof obj[k] === 'string' && (obj[k] as string).length > 0) return obj[k] as string
    }
    if (Array.isArray(obj.parts)) return extractTextFromUnknown(obj.parts, depth + 1)
  }
  return ''
}

function resolveSessionId(payload: Record<string, unknown>): { id: string; raw?: any } {
  const agent = payload?.agent as { session?: { id?: string; append?: (t: string, d: unknown) => unknown } } | undefined
  const sess = (payload?.session as { id?: string; append?: (t: string, d: unknown) => unknown } | undefined) ?? agent?.session
  if (sess && typeof sess.id === 'string') return { id: sess.id, raw: sess }
  if (typeof payload?.sessionId === 'string') return { id: payload.sessionId }
  return { id: 'default-session' }
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

  // Register durable projection for honest verdict badges across restarts/forks
  const projections = ctx.get('sessionProjections') as SessionProjectionsLike | undefined
  if (projections && typeof projections.register === 'function') {
    const disposeProj = projections.register({
      key: 'governanceEvidenceVerdicts',
      initial: () => [] as TurnVerificationReport[],
      reduce: (state: TurnVerificationReport[], event) => {
        if (event?.type !== VERDICT_SESSION_EVENT_TYPE || !event.data) return state
        return [...state.slice(-99), event.data as TurnVerificationReport]
      },
    })
    ctx.effect?.(() => disposeProj, 'dsh-grounding-guard: projection')
  }

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

    // Avoid duplicate passive captures of identical locator + sha256 + offset
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
          // Fail-closed: never retain 'verified' when Stage 2 NLI was requested and failed
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

  const pushVerdict = (report: TurnVerificationReport, rawSession?: { append?: (t: string, d: unknown) => unknown }) => {
    const arr = verdictsBySession.get(report.sessionId) ?? []
    arr.push(report)
    if (arr.length > 100) arr.shift()
    verdictsBySession.set(report.sessionId, arr)

    try {
      rawSession?.append?.(VERDICT_SESSION_EVENT_TYPE, report)
    } catch {
      /* session may be read-only in unit mocks */
    }
    recordAudit({
      stream: 'governance',
      eventName: 'grounding.turn_verified',
      actorType: 'system',
      actorId: 'dsh-grounding-guard',
      resourceType: 'session_turn',
      resourceId: report.turnKey,
      outcome: report.verdict === 'contradicted' ? 'denied' : 'success',
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

  // Hook 1: tools/post-execute (memory absolute wording guard + write receipt convergence + passive evidence capture)
  const disposePostExec = ctx.on?.('tools/post-execute', (exec: Record<string, unknown>, rawResult: unknown) => {
    const toolName = String(exec?.toolName ?? exec?.name ?? '')
    const args = exec?.args ?? exec?.arguments
    const { id: sessionId } = resolveSessionId(exec)

    // 1a. Block unquoted absolute generalizations on memory-write tools
    if (enableAbsoluteWordingGuard && isMemoryTool(toolName, config.memoryTools)) {
      const textToInspect = extractTextFromUnknown(args) || extractTextFromUnknown(rawResult)
      if (containsUnquotedAbsoluteWording(textToInspect)) {
        const hits = findUnquotedAbsoluteWording(textToInspect)
        recordAudit({
          stream: 'governance',
          eventName: 'grounding.absolute_wording_blocked',
          actorType: 'agent',
          actorId: sessionId,
          resourceType: 'memory_write',
          resourceId: toolName,
          outcome: 'denied',
          payload: { hits: hits.slice(0, 5) },
        })
        return {
          kind: 'block',
          reason: `Memory distillation blocked by absoluteWordingGuard (unquoted absolute terms: ${[...new Set(hits)].slice(0, 4).join(', ')}). Drop or cite exact user quote.`,
        }
      }
    }

    // 1b. Write-tool receipt convergence (strip raw file body echo)
    if (enableWriteReceiptFlowback && isWriteReceiptTool(toolName, config.writeTools)) {
      const alreadyReceipt =
        rawResult && typeof rawResult === 'object' && (rawResult as Record<string, unknown>).contentKind === 'receipt'
      if (!alreadyReceipt) {
        const okFlag =
          rawResult && typeof rawResult === 'object' && typeof (rawResult as Record<string, unknown>).ok === 'boolean'
            ? Boolean((rawResult as Record<string, unknown>).ok)
            : true
        const receipt = buildWriteReceipt(toolName, rawResult, okFlag, args)
        return { kind: 'replace', result: receipt }
      }
      return undefined
    }

    // 1c. Passive evidence & truncation capture from read/search tools
    if (PASSIVE_READ_TOOLS.has(toolName.trim().toLowerCase())) {
      const resObj = rawResult && typeof rawResult === 'object' ? (rawResult as Record<string, unknown>) : undefined
      const argsObj = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined
      const content = extractTextFromUnknown(rawResult)
      if (content.length > 0) {
        const locator = String(
          resObj?.locator ??
            resObj?.path ??
            argsObj?.path ??
            argsObj?.filePath ??
            argsObj?.url ??
            argsObj?.query ??
            toolName,
        )
        const truncated = Boolean(resObj?.truncated)
        const nextOffset = typeof resObj?.nextOffset === 'number' ? resObj.nextOffset : undefined
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
          bytes: typeof resObj?.bytes === 'number' ? resObj.bytes : Buffer.byteLength(content, 'utf8'),
        })
      }
    }
    return undefined
  })

  // Hook 2: agent/turn-stopping (Stage 1 deterministic + optional Stage 2 NLI + bounded 1-retry steer)
  const disposeTurnStop = ctx.on?.('agent/turn-stopping', async (event: Record<string, unknown>) => {
    const { id: sessionId, raw: rawSession } = resolveSessionId(event)
    const draftText = extractTextFromUnknown(event?.draft ?? event?.text ?? event?.message ?? event?.response)
    if (!draftText.trim()) return undefined

    const turnKey = String(event?.turnId ?? event?.turnKey ?? `${sessionId}:turn-${event?.turnIndex ?? 0}`)
    const report = await verifyTurnTextInternal(sessionId, draftText, { turnKey })

    const blockingIssues = report.issues.filter((i) => i.severity === 'error')
    const currentSteers = steerCountsByTurn.get(turnKey) ?? 0
    const agent = event?.agent as { steer?: (instruction: string) => void | Promise<void> } | undefined

    if (mode === 'enforce' && blockingIssues.length > 0 && currentSteers < maxSteerCorrections && typeof agent?.steer === 'function') {
      steerCountsByTurn.set(turnKey, currentSteers + 1)
      const steeredReport: TurnVerificationReport = { ...report, steered: true }
      pushVerdict(steeredReport, rawSession)
      const reasons = blockingIssues.map((i) => `- [${i.code}] ${i.message}`).join('\n')
      await agent.steer(
        `[dsh-grounding-guard] Grounding verification failed (${blockingIssues.length} issue(s)). Fix the response using only verified evidence or state uncertainty explicitly:\n${reasons}`,
      )
      return steeredReport
    }

    pushVerdict(report, rawSession)
    return report
  })

  // Authenticated Host RPC: /api/dshGroundingGuard
  const connection = ctx.get('connection') as OfficialHostConnection | undefined
  let disposeRoute: (() => Promise<void> | void) | undefined
  if (connection?.fetch?.register) {
    disposeRoute = connection.fetch.register({
      path: '/api/dshGroundingGuard',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const body = (await request.json().catch(() => ({}))) as {
          rpcId?: string
          method?: string
          payload?: Record<string, unknown>
        }
        const rpcId = body.rpcId ?? ''
        const method = body.method ?? 'status'
        const payload = body.payload ?? {}

        try {
          let result: unknown
          if (method === 'status') {
            result = {
              config: service.getConfig(),
              evidenceCount: service.listEvidence().length,
              verdictCount: service.listVerdicts().length,
            }
          } else if (method === 'listEvidence') {
            result = {
              items: service.listEvidence(typeof payload.sessionId === 'string' ? payload.sessionId : undefined),
            }
          } else if (method === 'listVerdicts') {
            result = {
              items: service.listVerdicts(typeof payload.sessionId === 'string' ? payload.sessionId : undefined).slice(-50).reverse(),
            }
          } else if (method === 'setNliEnabled') {
            service.setNliEnabled(Boolean(payload.enabled))
            result = { config: service.getConfig() }
          } else if (method === 'setMode') {
            const next = payload.mode === 'observe' ? 'observe' : 'enforce'
            service.setMode(next)
            result = { config: service.getConfig() }
          } else if (method === 'verifyText') {
            const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : 'default-session'
            const text = typeof payload.text === 'string' ? payload.text : ''
            result = await service.verifyTurnText(sessionId, text, {
              runNli: typeof payload.runNli === 'boolean' ? payload.runNli : undefined,
            })
          } else {
            return Response.json(
              { type: 'server-response', rpcId, error: { code: 'UNKNOWN_METHOD', message: `Unknown method: ${method}` } },
              { status: 400 },
            )
          }
          return Response.json({ type: 'server-response', rpcId, result })
        } catch (err) {
          return Response.json(
            {
              type: 'server-response',
              rpcId,
              error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) },
            },
            { status: 500 },
          )
        }
      },
    })
  }

  ctx.effect?.(() => {
    return async () => {
      disposePostExec?.()
      disposeTurnStop?.()
      await disposeRoute?.()
    }
  }, 'dsh-grounding-guard: cleanup')

  return service
}
