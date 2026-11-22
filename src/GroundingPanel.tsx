import { useCallback, useEffect, useState } from 'react'
import styles from './grounding.module.css'
import type { EvidenceRecord, GroundingMode, TurnVerificationReport, VerificationVerdict } from './core/types.js'

export interface GroundingRpcCaller {
  call<T = any>(method: string, payload?: Record<string, unknown>): Promise<T>
}

interface StatusPayload {
  readonly config: {
    readonly mode: GroundingMode
    readonly maxSteerCorrections: number
    readonly enableNliStage2: boolean
    readonly enableWriteReceiptFlowback: boolean
    readonly enableAbsoluteWordingGuard: boolean
  }
  readonly evidenceCount: number
  readonly verdictCount: number
}

function verdictClass(verdict: VerificationVerdict): string {
  if (verdict === 'verified') return styles.badgeVerified ?? ''
  if (verdict === 'partial') return styles.badgePartial ?? ''
  if (verdict === 'contradicted') return styles.badgeContradicted ?? ''
  return styles.badgeUnverified ?? ''
}

export function GroundingPanel({
  rpc,
  t,
}: {
  readonly rpc: GroundingRpcCaller
  readonly t: (key: string) => string
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [verdicts, setVerdicts] = useState<readonly TurnVerificationReport[]>([])
  const [evidence, setEvidence] = useState<readonly EvidenceRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, v, e] = await Promise.all([
        rpc.call<StatusPayload>('status'),
        rpc.call<{ items: TurnVerificationReport[] }>('listVerdicts'),
        rpc.call<{ items: EvidenceRecord[] }>('listEvidence'),
      ])
      setStatus(s)
      setVerdicts(v.items ?? [])
      setEvidence(e.items ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rpc])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleNli = async () => {
    if (!status) return
    await rpc.call('setNliEnabled', { enabled: !status.config.enableNliStage2 })
    await refresh()
  }

  const toggleMode = async () => {
    if (!status) return
    await rpc.call('setMode', { mode: status.config.mode === 'enforce' ? 'observe' : 'enforce' })
    await refresh()
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </div>
        <div className={styles.controls}>
          <button type="button" className={`${styles.btn} ${status?.config.mode === 'enforce' ? styles.btnActive : ''}`} onClick={toggleMode}>
            {t('action.mode')}: {status?.config.mode ?? '...'}
          </button>
          <button type="button" className={`${styles.btn} ${status?.config.enableNliStage2 ? styles.btnActive : ''}`} onClick={toggleNli}>
            {t('action.nli')}: {status?.config.enableNliStage2 ? 'ON' : 'OFF'}
          </button>
          <button type="button" className={styles.btn} onClick={refresh}>
            {t('action.refresh')}
          </button>
        </div>
      </div>

      {error && <div className={styles.row}>{error}</div>}

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>{t('metric.evidence')}</div>
          <div className={styles.cardValue}>{status?.evidenceCount ?? 0}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>{t('metric.verdicts')}</div>
          <div className={styles.cardValue}>{status?.verdictCount ?? 0}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>{t('metric.maxSteer')}</div>
          <div className={styles.cardValue}>{status?.config.maxSteerCorrections ?? 1}</div>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>{t('section.verdicts')}</h3>
        {verdicts.length === 0 ? (
          <div className={styles.empty}>{t('empty.verdicts')}</div>
        ) : (
          <div className={styles.list}>
            {verdicts.slice(0, 20).map((item) => (
              <div key={item.id} className={styles.row}>
                <div>
                  <div>
                    <span className={`${styles.badge} ${verdictClass(item.verdict)}`}>{item.verdict}</span>{' '}
                    <span className={styles.mono}>{item.turnKey}</span>
                    {item.steered ? ' · steered' : ''}
                    {item.nliUsed ? ' · NLI' : ' · Stage 1'}
                  </div>
                  {item.issues.length > 0 && (
                    <div className={styles.mono}>{item.issues.map((i) => `${i.code}: ${i.message}`).join(' | ')}</div>
                  )}
                </div>
                <span className={styles.mono}>{item.createdAt}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>{t('section.evidence')}</h3>
        {evidence.length === 0 ? (
          <div className={styles.empty}>{t('empty.evidence')}</div>
        ) : (
          <div className={styles.list}>
            {evidence.slice(-20).reverse().map((ev) => (
              <div key={ev.id} className={styles.row}>
                <div>
                  <div>
                    <strong>{ev.id}</strong> · {ev.locator}{' '}
                    <span className={`${styles.badge} ${ev.truncated ? styles.badgePartial : styles.badgeVerified}`}>
                      {ev.truncated ? `truncated (next=${ev.nextOffset ?? '?'})` : ev.auditability}
                    </span>
                  </div>
                  <div className={styles.mono}>{ev.excerpt.slice(0, 140)}</div>
                </div>
                <span className={styles.mono}>{ev.sha256.slice(0, 12)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
