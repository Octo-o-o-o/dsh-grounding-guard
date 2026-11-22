export type SourceAuditability = 'auditable' | 'partial' | 'unverified'

export type EvidenceSourceType = 'file' | 'kb' | 'query' | 'tool' | 'artifact' | 'web'

export interface EvidenceRecordInput {
  readonly id?: string
  readonly sessionId: string
  readonly sourceType: EvidenceSourceType
  readonly locator: string
  readonly title?: string
  readonly excerpt: string
  readonly fullText?: string
  readonly sha256?: string
  readonly bytes?: number
  readonly truncated?: boolean
  readonly nextOffset?: number
  readonly totalBytes?: number
  readonly lineStart?: number
  readonly lineEnd?: number
  readonly auditability?: SourceAuditability
}

export interface EvidenceRecord {
  readonly id: string
  readonly sessionId: string
  readonly sourceType: EvidenceSourceType
  readonly locator: string
  readonly title?: string
  readonly excerpt: string
  readonly fullText?: string
  readonly sha256: string
  readonly bytes?: number
  readonly truncated: boolean
  readonly nextOffset?: number
  readonly totalBytes?: number
  readonly lineStart?: number
  readonly lineEnd?: number
  readonly auditability: SourceAuditability
  readonly capturedAt: string
}

export interface WriteReceipt {
  readonly tool: string
  readonly ok: boolean
  readonly contentKind: 'receipt'
  readonly paths: readonly string[]
  readonly metrics: Readonly<Record<string, number>>
  readonly states: Readonly<Record<string, boolean>>
  readonly sha256?: string
  readonly errorKind?: string
  readonly errorMessage?: string
}

export type VerificationVerdict = 'verified' | 'partial' | 'unverified' | 'contradicted'

export type VerificationIssueCode =
  | 'FABRICATED_CITATION'
  | 'QUOTE_NOT_LOCATED'
  | 'TRUNCATED_EXHAUSTIVE_CLAIM'
  | 'UNVERIFIED_SOURCE'
  | 'ABSOLUTE_WORDING'
  | 'NLI_PARTIAL'
  | 'NLI_UNSUPPORTED'
  | 'NLI_CONTRADICTED'
  | 'NLI_UNAVAILABLE'

export interface VerificationIssue {
  readonly code: VerificationIssueCode
  readonly severity: 'error' | 'warn'
  readonly message: string
  readonly citationId?: string
  readonly locator?: string
}

export interface TurnVerificationReport {
  readonly id: string
  readonly sessionId: string
  readonly turnKey: string
  readonly verdict: VerificationVerdict
  readonly issues: readonly VerificationIssue[]
  readonly citedEvidenceIds: readonly string[]
  readonly totalEvidenceCount: number
  readonly nliUsed: boolean
  readonly steered: boolean
  readonly createdAt: string
}

export type GroundingMode = 'enforce' | 'observe'

export interface GroundingConfig {
  readonly mode?: GroundingMode
  readonly maxSteerCorrections?: number
  readonly enableWriteReceiptFlowback?: boolean
  readonly writeTools?: readonly string[]
  readonly enableNliStage2?: boolean
  readonly nliPurpose?: string
  readonly nliTimeoutMs?: number
  readonly enableAbsoluteWordingGuard?: boolean
  readonly memoryTools?: readonly string[]
}

export interface QueryColumnMeta {
  readonly name: string
  readonly type: 'integer' | 'decimal' | 'float' | 'number' | 'text' | 'date' | 'timestamp' | 'boolean'
  readonly label?: string
  readonly unit?: string
  readonly role?: 'dimension' | 'measure'
}

export interface QueryResultView {
  readonly runId: string
  readonly status: 'succeeded' | 'failed'
  readonly assetName: string
  readonly mode: 'template' | 'explore'
  readonly definition?: string
  readonly dataAsOf: string
  readonly period?: { readonly from?: string; readonly to?: string }
  readonly truncated?: boolean
  readonly rowsWithheld?: 'policy' | 'size'
  readonly columns: readonly QueryColumnMeta[]
  readonly rows?: readonly (readonly (string | number | boolean | null)[])[]
  readonly caveats?: readonly string[]
  readonly warnings?: readonly string[]
}

export interface CheckedAnswerBlocks {
  readonly ok: boolean
  readonly code?: 'invalid_json' | 'invalid_structure' | 'invalid_reference' | 'answer_too_long'
  readonly reason?: string
  readonly kind?: 'answered' | 'clarification' | 'insufficient_data'
  readonly text?: string
  readonly facts?: readonly {
    readonly runId: string
    readonly row: number
    readonly column: string
    readonly dimensions: readonly string[]
  }[]
  readonly tableRunIds?: readonly string[]
  readonly cautions?: readonly string[]
}

export interface ArtifactCriterion {
  readonly kind: 'file' | 'csv'
  readonly relativePath: string
  readonly expectedBytes?: number
  readonly expectedSha256?: string
  readonly columns?: readonly string[]
  readonly expectedRows?: number
  readonly sums?: Readonly<Record<string, number>>
}

export interface ArtifactVerificationResult {
  readonly status: 'supported' | 'unsupported'
  readonly reason: string
  readonly sha256?: string
  readonly bytes?: number
  readonly checkedAt: string
}

export interface GovernanceEvidenceService {
  registerEvidence(input: EvidenceRecordInput): EvidenceRecord
  listEvidence(sessionId?: string): readonly EvidenceRecord[]
  clearSession(sessionId: string): void
  registerQueryView(sessionId: string, view: QueryResultView): void
  listQueryViews(sessionId: string): readonly QueryResultView[]
  normalizeWriteResult(toolName: string, rawResult: unknown, ok?: boolean): WriteReceipt
  verifyTurnText(sessionId: string, text: string, opts?: { runNli?: boolean }): Promise<TurnVerificationReport>
  verifyAnswerBlocks(
    rawJson: string,
    views: ReadonlyMap<string, QueryResultView>,
    metadata?: ReadonlyMap<string, string>,
  ): CheckedAnswerBlocks
  verifyArtifact(rootPath: string, criterion: ArtifactCriterion): ArtifactVerificationResult
  checkAbsoluteWording(text: string | undefined | null): { readonly flagged: boolean; readonly matches: readonly string[] }
  listVerdicts(sessionId?: string): readonly TurnVerificationReport[]
  getConfig(): Required<Pick<GroundingConfig, 'mode' | 'maxSteerCorrections' | 'enableWriteReceiptFlowback' | 'enableNliStage2' | 'nliPurpose' | 'nliTimeoutMs' | 'enableAbsoluteWordingGuard'>>
  setNliEnabled(enabled: boolean): void
  setMode(mode: GroundingMode): void
}
