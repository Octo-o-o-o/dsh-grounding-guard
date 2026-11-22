/**
 * Official dsh@0.2.2-rc.5 Client entrypoint for `dsh-grounding-guard`.
 */
import { GroundingPanel, type GroundingRpcCaller } from './GroundingPanel.js'

interface LocaleApi {
  register(namespace: string, locale: string, dictionary: Record<string, string>): () => void
  bind(namespace: string): (key: string) => string
}

interface SlotsApi {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface ConnectionClientApi {
  readonly rpc: {
    call<T = unknown>(
      channel: string,
      endpoint: string,
      payload?: unknown,
    ): Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>
  }
}

interface ClientContext {
  effect(run: () => void | (() => void), label?: string): void
  locale: LocaleApi
  slots: SlotsApi
  connection: ConnectionClientApi
}

const NS = 'dshGroundingGuard'
const PANEL_ID = 'dsh-grounding-guard'

function GroundingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7.2" cy="7.2" r="4.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 7.4L6.6 8.8L9.6 5.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.8 10.8L13.8 13.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export const inject = ['slots', 'locale', 'layout', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposeZh = ctx.locale.register(NS, 'zh', {
      nav: '证据护栏',
      title: '证据护栏与反幻觉校验台',
      subtitle: 'Stage 1 确定性引文定位与截断断言守卫 · answerBlocks · 写入回执收敛 · 可选 Stage 2 独立 NLI',
      'action.mode': '模式',
      'action.nli': 'Stage 2 NLI',
      'action.refresh': '刷新',
      'metric.evidence': '已登记证据条数',
      'metric.verdicts': '已校验回合数',
      'metric.maxSteer': '单轮自纠上限',
      'section.verdicts': '回合诚实校验结论（持久化）',
      'section.evidence': '会话证据总线记录',
      'empty.verdicts': '暂无校验记录',
      'empty.evidence': '当前会话尚未捕获工具或知识库证据',
    })
    const disposeEn = ctx.locale.register(NS, 'en', {
      nav: 'Grounding',
      title: 'Grounding & Evidence Verification Console',
      subtitle: 'Stage 1 deterministic quote & truncation guard · answerBlocks · write receipts · optional Stage 2 NLI',
      'action.mode': 'Mode',
      'action.nli': 'Stage 2 NLI',
      'action.refresh': 'Refresh',
      'metric.evidence': 'Registered Evidence',
      'metric.verdicts': 'Verified Turns',
      'metric.maxSteer': 'Max Steer Retries',
      'section.verdicts': 'Honest Turn Verdicts (Persisted)',
      'section.evidence': 'Session Evidence Bus',
      'empty.verdicts': 'No verified turns yet',
      'empty.evidence': 'No tool or KB evidence captured yet',
    })
    return () => {
      disposeZh()
      disposeEn()
    }
  }, 'dsh-grounding-guard: dictionaries')

  const t = ctx.locale.bind(NS)
  const rpc: GroundingRpcCaller = {
    async call<T = any>(method: string, payload?: Record<string, unknown>): Promise<T> {
      const res = await ctx.connection.rpc.call<T>('/api', 'dshGroundingGuard', {
        method,
        payload: payload ?? {},
      })
      if (!res.ok) throw new Error(res.error?.message ?? `RPC failed: ${method}`)
      return res.value
    },
  }

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ rpc, t }),
      },
      GroundingPanel,
    ),
  )

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 64,
        locale: NS,
        label: () => t('nav'),
      },
      GroundingIcon,
    ),
  )
}
