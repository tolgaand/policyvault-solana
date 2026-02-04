import { useMemo, useState } from 'react'
import { AnchorProvider, web3, BN } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

import {
  deriveAuditEventPda,
  derivePolicyPda,
  deriveRecipientSpendPda,
  deriveVaultPda,
  getProgram,
  programId,
} from './policyvault'
import { runPreflight, REASON_LABELS, type PolicySnapshot, type RecipientSpendSnapshot } from './preflight'
import './App.css'

type TxLog = { label: string; sig: string }
type AuditEventEntry = {
  sequence: bigint
  allowed: boolean
  reasonCode: unknown
  amount: unknown
  recipient: string
  ts: unknown
}

const REASON_CODE = REASON_LABELS

function normalizeU16(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)

  // Anchor can decode integer fields as BN depending on IDL/typegen.
  if (typeof v === 'object' && v && 'toNumber' in v) {
    const anyV = v as { toNumber?: () => number }
    if (typeof anyV.toNumber === 'function') return anyV.toNumber()
  }

  return null
}

function formatReason(code: unknown) {
  const n = normalizeU16(code)
  if (n === null) return 'UNKNOWN'
  return `${n} ${REASON_CODE[n] ?? 'UNKNOWN'}`
}

function toBigInt(v: unknown): bigint | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(Math.trunc(v))

  // Anchor decodes u64 as BN.
  if (typeof v === 'object' && v && 'toString' in v) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (v as any).toString()
      return BigInt(s)
    } catch {
      return null
    }
  }

  return null
}

function formatLamports(v: unknown): string {
  const bi = toBigInt(v)
  if (bi === null) return '—'

  // Display both lamports and a human SOL approximation.
  const sol = Number(bi) / web3.LAMPORTS_PER_SOL
  const solStr = Number.isFinite(sol) ? sol.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '…'
  return `${bi.toString()} lamports (${solStr} SOL)`
}

function formatTimestamp(v: unknown): string {
  const bi = toBigInt(v)
  if (bi === null) return '—'
  const ms = Number(bi) * 1000
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

function lamports(sol: number) { 
  return Math.round(sol * web3.LAMPORTS_PER_SOL)
}

function parsePubkey(s: string): PublicKey {
  return new PublicKey(s.trim())
}

function tryParsePubkey(s: string): PublicKey | null {
  try {
    return parsePubkey(s)
  } catch {
    return null
  }
}

export default function DemoApp() {
  const { connection } = useConnection()
  const wallet = useWallet()

  const [vaultPda, setVaultPda] = useState<string | null>(null)
  const [policyPda, setPolicyPda] = useState<string | null>(null)

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null

    const anchorWallet = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    }

    return new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' })
  }, [connection, wallet])

  const program = useMemo(() => (provider ? getProgram(provider) : null), [provider])

  const [logs, setLogs] = useState<TxLog[]>([])
  const [dailyBudgetSol, setDailyBudgetSol] = useState(0.5)
  const [cooldownSeconds, setCooldownSeconds] = useState(60)
  const [spendAmountSol, setSpendAmountSol] = useState(0.1)
  const [auditEvents, setAuditEvents] = useState<AuditEventEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  function applyPreset(preset: 'budget_only' | 'paused' | 'allowlist_cap') {
    const self = wallet.publicKey?.toBase58() ?? ''

    if (preset === 'budget_only') {
      setPaused(false)
      setAllowlistEnabled(false)
      setAllowedRecipient('')
      setPerRecipientCapSol(0.25)
      setDailyBudgetSol(0.5)
      setCooldownSeconds(60)
      setSpendAmountSol(0.1)
      return
    }

    if (preset === 'paused') {
      setPaused(true)
      setAllowlistEnabled(false)
      setAllowedRecipient('')
      setPerRecipientCapSol(0.25)
      setDailyBudgetSol(0.5)
      setCooldownSeconds(60)
      setSpendAmountSol(0.1)
      return
    }

    // allowlist_cap
    setPaused(false)
    setAllowlistEnabled(true)
    setAllowedRecipient(self)
    setRecipientAddress(self)
    setPerRecipientCapSol(0.25)
    setDailyBudgetSol(0.5)
    setCooldownSeconds(0)
    setSpendAmountSol(0.1)
  }

  // Advanced policy knobs (wired to set_policy_advanced + spend_intent_v2)
  const [paused, setPaused] = useState(false)
  const [allowlistEnabled, setAllowlistEnabled] = useState(false)
  const [allowedRecipient, setAllowedRecipient] = useState('')
  const [perRecipientCapSol, setPerRecipientCapSol] = useState(0.25)
  const [recipientAddress, setRecipientAddress] = useState('')

  const [uiError, setUiError] = useState<string | null>(null)

  const [policySnapshot, setPolicySnapshot] = useState<null | {
    dailyBudgetLamports?: unknown
    spentTodayLamports?: unknown
    dayIndex?: unknown
    cooldownSeconds?: unknown
    lastSpendTs?: unknown
    nextSequence?: unknown
    paused?: boolean
    allowlistEnabled?: boolean
    allowedRecipient?: unknown
    perRecipientDailyCapLamports?: unknown
    policyVersion?: unknown
    agent?: unknown
  }>(null)

  const [recipientSpendSnapshot, setRecipientSpendSnapshot] = useState<null | {
    spentTodayLamports?: unknown
    dayIndex?: unknown
  }>(null)

  /** Normalised policy snapshot fed into the preflight pipeline. */
  const normalisedPolicySnapshot: PolicySnapshot | null = useMemo(() => {
    if (!policySnapshot) return null
    return {
      dailyBudgetLamports: toBigInt(policySnapshot.dailyBudgetLamports) ?? 0n,
      spentTodayLamports: toBigInt(policySnapshot.spentTodayLamports) ?? 0n,
      dayIndex: toBigInt(policySnapshot.dayIndex) ?? 0n,
      cooldownSeconds: Number(policySnapshot.cooldownSeconds) || 0,
      lastSpendTs: toBigInt(policySnapshot.lastSpendTs) ?? 0n,
      paused: Boolean(policySnapshot.paused),
      allowlistEnabled: Boolean(policySnapshot.allowlistEnabled),
      allowedRecipient: policySnapshot.allowedRecipient ? String(policySnapshot.allowedRecipient) : null,
      perRecipientDailyCapLamports: toBigInt(policySnapshot.perRecipientDailyCapLamports) ?? 0n,
    }
  }, [policySnapshot])

  const normalisedRecipientSnap: RecipientSpendSnapshot | null = useMemo(() => {
    if (!recipientSpendSnapshot) return null
    return {
      spentTodayLamports: toBigInt(recipientSpendSnapshot.spentTodayLamports) ?? 0n,
      dayIndex: toBigInt(recipientSpendSnapshot.dayIndex) ?? 0n,
    }
  }, [recipientSpendSnapshot])

  const preflight = useMemo(() => {
    return runPreflight({
      walletConnected: wallet.connected,
      spendAmountSol,
      recipientAddress,
      dailyBudgetSol,
      cooldownSeconds,
      perRecipientCapSol,
      paused,
      allowlistEnabled,
      allowedRecipient,
      walletAddress: wallet.publicKey?.toBase58() ?? null,
      policySnapshot: normalisedPolicySnapshot,
      recipientSpendSnapshot: normalisedRecipientSnap,
    })
  }, [
    wallet.connected,
    wallet.publicKey,
    normalisedPolicySnapshot,
    normalisedRecipientSnap,
    spendAmountSol,
    paused,
    allowlistEnabled,
    allowedRecipient,
    perRecipientCapSol,
    dailyBudgetSol,
    cooldownSeconds,
    recipientAddress,
  ])

  const pushLog = (label: string, sig: string) => setLogs((l) => [{ label, sig }, ...l])

  async function runAction(label: string, fn: () => Promise<void>) {
    setUiError(null)
    try {
      await fn()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setUiError(`${label}: ${msg}`)
      console.error(label, e)
    }
  }

  async function refreshPdas() {
    if (!wallet.publicKey) {
      setVaultPda(null)
      setPolicyPda(null)
      return
    }
    const [vault] = await deriveVaultPda(wallet.publicKey)
    const [policy] = await derivePolicyPda(vault)
    setVaultPda(vault.toBase58())
    setPolicyPda(policy.toBase58())
  }

  async function fetchOnchainState() {
    await runAction('fetch_onchain_state', async () => {
      const { program, owner } = await ensureWallet()
      const [vault] = await deriveVaultPda(owner)
      const [policy] = await derivePolicyPda(vault)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await (program as any).account.policy.fetch(policy)) as any
      setPolicySnapshot({
        dailyBudgetLamports: p.dailyBudgetLamports ?? p.daily_budget_lamports,
        spentTodayLamports: p.spentTodayLamports ?? p.spent_today_lamports,
        dayIndex: p.dayIndex ?? p.day_index,
        cooldownSeconds: p.cooldownSeconds ?? p.cooldown_seconds,
        lastSpendTs: p.lastSpendTs ?? p.last_spend_ts,
        nextSequence: p.nextSequence ?? p.next_sequence,
        paused: Boolean(p.paused),
        allowlistEnabled: Boolean(p.allowlistEnabled ?? p.allowlist_enabled),
        allowedRecipient: p.allowedRecipient ?? p.allowed_recipient,
        perRecipientDailyCapLamports: p.perRecipientDailyCapLamports ?? p.per_recipient_daily_cap_lamports,
        policyVersion: p.policyVersion ?? p.policy_version,
        agent: p.agent,
      })

      // RecipientSpend is optional; only fetch if a recipient can be parsed.
      const recipientStr = (recipientAddress || owner.toBase58()).trim()
      const recipientPk = tryParsePubkey(recipientStr)
      if (!recipientPk) {
        setRecipientSpendSnapshot(null)
        return
      }

      const [recipientSpend] = await deriveRecipientSpendPda(policy, recipientPk)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rs = (await (program as any).account.recipientSpend.fetch(recipientSpend)) as any
        setRecipientSpendSnapshot({
          spentTodayLamports: rs.spentTodayLamports ?? rs.spent_today_lamports,
          dayIndex: rs.dayIndex ?? rs.day_index,
        })
      } catch {
        setRecipientSpendSnapshot(null)
      }

      await refreshPdas()
    })
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
  }

  async function ensureWallet() {
    if (!wallet.publicKey) throw new Error('Connect wallet')
    if (!provider || !program) throw new Error('Provider not ready')
    return { provider, program, owner: wallet.publicKey }
  }

  async function onInitVault() {
    await runAction('initialize_vault', async () => {
      const { program, owner } = await ensureWallet()
      const [vault] = await deriveVaultPda(owner)

      const sig = await program.methods
        .initializeVault()
        .accounts({ vault, owner, systemProgram: web3.SystemProgram.programId })
        .rpc()

      pushLog('initialize_vault', sig)
      await refreshPdas()
    })
  }

  async function onInitPolicy() {
    await runAction('initialize_policy', async () => {
      const { program, owner } = await ensureWallet()
      const [vault] = await deriveVaultPda(owner)
      const [policy] = await derivePolicyPda(vault)

      const sig = await program.methods
        .initializePolicy(new BN(lamports(dailyBudgetSol)), cooldownSeconds, null)
        .accounts({ policy, vault, owner, systemProgram: web3.SystemProgram.programId })
        .rpc()

      pushLog('initialize_policy', sig)
      await refreshPdas()
    })
  }

  async function onSetPolicy() {
    await runAction('set_policy', async () => {
      const { program, owner } = await ensureWallet()
      const [vault] = await deriveVaultPda(owner)
      const [policy] = await derivePolicyPda(vault)

      const sig = await program.methods
        .setPolicy(new BN(lamports(dailyBudgetSol)), cooldownSeconds, null)
        .accounts({ policy, vault, authority: owner })
        .rpc()

      pushLog('set_policy', sig)
      await refreshPdas()
    })
  }

  async function onSetPolicyAdvanced() {
    await runAction('set_policy_advanced', async () => {
      const { program, owner } = await ensureWallet()
      const [vault] = await deriveVaultPda(owner)
      const [policy] = await derivePolicyPda(vault)

      let allowedRecipientOption: PublicKey | null = null
      if (allowlistEnabled) {
        const candidate = (allowedRecipient || recipientAddress || owner.toBase58()).trim()
        const pk = tryParsePubkey(candidate)
        if (!pk) throw new Error('Invalid allowed recipient pubkey')
        allowedRecipientOption = pk
      }

      const sig = await program.methods
        .setPolicyAdvanced(
          new BN(lamports(dailyBudgetSol)),
          cooldownSeconds,
          null,
          paused,
          allowlistEnabled,
          allowedRecipientOption,
          new BN(lamports(perRecipientCapSol)),
        )
        .accounts({ policy, vault, authority: owner })
        .rpc()

      pushLog('set_policy_advanced', sig)
      await refreshPdas()
    })
  }

  async function onSpendIntent() {
    await runAction('spend_intent', async () => {
      const { program, owner } = await ensureWallet()
      const [vault] = await deriveVaultPda(owner)
      const [policy] = await derivePolicyPda(vault)

      const sig = await program.methods
        .spendIntent(new BN(lamports(spendAmountSol)))
        .accounts({ vault, policy, recipient: owner, caller: owner, systemProgram: web3.SystemProgram.programId })
        .rpc()

      pushLog('spend_intent', sig)
      await refreshPdas()
    })
  }

  async function onSpendIntentV2() {
    await runAction('spend_intent_v2', async () => {
      const { program, owner } = await ensureWallet()
      const [vault] = await deriveVaultPda(owner)
      const [policy] = await derivePolicyPda(vault)

      const recipientStr = (recipientAddress || owner.toBase58()).trim()
      const recipientPk = tryParsePubkey(recipientStr)
      if (!recipientPk) throw new Error('Invalid recipient pubkey')

      // PDA seeds for audit_event include policy.next_sequence, so we fetch the policy first.
      const policyAcct = (await (
        program as unknown as {
          account: { policy: { fetch: (pk: PublicKey) => Promise<unknown> } }
        }
      ).account.policy.fetch(policy)) as { nextSequence?: BN; next_sequence?: BN }

      const nextSeq: BN | undefined = policyAcct.nextSequence ?? policyAcct.next_sequence
      if (!nextSeq) throw new Error('Failed to read policy.next_sequence')

      const [auditEvent] = await deriveAuditEventPda(policy, nextSeq)
      const [recipientSpend] = await deriveRecipientSpendPda(policy, recipientPk)

      const sig = await program.methods
        .spendIntentV2(new BN(lamports(spendAmountSol)))
        .accounts({
          auditEvent,
          recipientSpend,
          policy,
          vault,
          recipient: recipientPk,
          caller: owner,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc()

      // Fetch audit_event to surface allow/deny + reason codes in the UI.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audit = (await (program as any).account.auditEvent.fetch(auditEvent)) as {
          allowed?: boolean
          reasonCode?: number
          reason_code?: number
          policyVersion?: number
          policy_version?: number
        }

        const allowed = Boolean(audit.allowed)
        const reason = formatReason(audit.reasonCode ?? audit.reason_code)
        const version = audit.policyVersion ?? audit.policy_version

        pushLog(`spend_intent_v2 (${allowed ? 'allowed' : 'denied'} · reason ${reason}${version ? ` · v${version}` : ''})`, sig)
      } catch {
        pushLog('spend_intent_v2', sig)
      }

      await refreshPdas()
    })
  }

  async function fetchRecentAuditEvents() {
    await runAction('fetch_recent_audit_events', async () => {
      setAuditLoading(true)
      try {
        const { program, owner } = await ensureWallet()
        const [vault] = await deriveVaultPda(owner)
        const [policy] = await derivePolicyPda(vault)

        const policyAcct = (await (
          program as unknown as {
            account: { policy: { fetch: (pk: PublicKey) => Promise<unknown> } }
          }
        ).account.policy.fetch(policy)) as { nextSequence?: BN; next_sequence?: BN }

        const nextSeq = policyAcct.nextSequence ?? policyAcct.next_sequence
        const nextSeqBig = toBigInt(nextSeq)
        if (nextSeqBig === null) throw new Error('Failed to read policy.next_sequence')

        const startSeq = nextSeqBig - 1n
        if (startSeq < 0n) {
          setAuditEvents([])
          return
        }

        const results: AuditEventEntry[] = []
        for (let i = 0; i < 5; i += 1) {
          const seq = startSeq - BigInt(i)
          if (seq < 0n) break

          const [auditEvent] = await deriveAuditEventPda(policy, seq)
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const audit = (await (program as any).account.auditEvent.fetch(auditEvent)) as any
            const seqValue = toBigInt(audit.sequence) ?? seq
            const recipient = audit.recipient?.toBase58 ? audit.recipient.toBase58() : String(audit.recipient ?? '—')
            results.push({
              sequence: seqValue,
              allowed: Boolean(audit.allowed),
              reasonCode: audit.reasonCode ?? audit.reason_code,
              amount: audit.amount,
              recipient,
              ts: audit.ts,
            })
          } catch {
            // ignore missing audit events
          }
        }

        results.sort((a, b) => (a.sequence > b.sequence ? -1 : a.sequence < b.sequence ? 1 : 0))
        setAuditEvents(results)
        await refreshPdas()
      } finally {
        setAuditLoading(false)
      }
    })
  }

  return (
    <>
      <section className="section" id="demo">
        <h2 className="section-title">Demo</h2>
        <p className="demo-hint">
          <code>initialize_vault</code> &rarr; <code>initialize_policy</code> &rarr; <code>set_policy</code> /{' '}
          <code>spend_intent</code>
          <span className="demo-hint-muted"> (open Advanced for pause/allowlist/caps + spend_intent_v2)</span>
        </p>

        <div className="demo-connect-row">
          <WalletMultiButton />
        </div>

        {uiError && (
          <div className="alert-error" role="alert">
            <strong>Action failed:</strong> {uiError}
          </div>
        )}

        <div className="glass-panel">
          <h3 className="panel-header">Policy Parameters</h3>
          <p className="demo-hint">
            Quick presets (edit local inputs only). Then click <code>set_policy</code> / <code>set_policy_advanced</code> to
            apply on-chain.
          </p>
          <div className="action-row" style={{ flexWrap: 'wrap' }}>
            <button className="btn-secondary" type="button" onClick={() => applyPreset('budget_only')}>
              Preset: Budget + Cooldown
            </button>
            <button className="btn-secondary" type="button" onClick={() => applyPreset('paused')}>
              Preset: Paused (Kill switch)
            </button>
            <button className="btn-secondary" type="button" onClick={() => applyPreset('allowlist_cap')}>
              Preset: Allowlist + Cap (v2)
            </button>
          </div>

          <div className="param-grid">
            <div className="param-group">
              <span className="param-label">Daily budget (SOL)</span>
              <input
                type="number"
                step="0.01"
                value={dailyBudgetSol}
                onChange={(e) => setDailyBudgetSol(Number(e.target.value))}
              />
            </div>
            <div className="param-group">
              <span className="param-label">Cooldown (seconds)</span>
              <input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value))} />
            </div>
            <div className="param-group">
              <span className="param-label">Spend amount (SOL)</span>
              <input
                type="number"
                step="0.01"
                value={spendAmountSol}
                onChange={(e) => setSpendAmountSol(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="action-row">
            <button disabled={!wallet.connected} onClick={onInitVault}>
              initialize_vault
            </button>
            <button disabled={!wallet.connected} onClick={onInitPolicy}>
              initialize_policy
            </button>
            <button disabled={!wallet.connected} onClick={onSetPolicy}>
              set_policy
            </button>
            <button disabled={!wallet.connected} onClick={onSpendIntent}>
              spend_intent
            </button>
          </div>

          <details className="accordion">
            <summary className="accordion-summary">Advanced (pause / allowlist / per-recipient cap / spend_intent_v2)</summary>
            <div className="accordion-body">
              <div className="param-grid">
                <label className="param-group param-inline">
                  <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
                  <span className="param-label">Paused (kill switch)</span>
                </label>

                <label className="param-group param-inline">
                  <input
                    type="checkbox"
                    checked={allowlistEnabled}
                    onChange={(e) => setAllowlistEnabled(e.target.checked)}
                  />
                  <span className="param-label">Allowlist enabled</span>
                </label>

                <div className="param-group">
                  <span className="param-label">Allowed recipient (base58)</span>
                  <input
                    placeholder={wallet.publicKey?.toBase58() ?? 'Recipient pubkey'}
                    value={allowedRecipient}
                    onChange={(e) => setAllowedRecipient(e.target.value)}
                    disabled={!allowlistEnabled}
                  />
                </div>

                <div className="param-group">
                  <span className="param-label">Per-recipient daily cap (SOL)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={perRecipientCapSol}
                    onChange={(e) => setPerRecipientCapSol(Number(e.target.value))}
                  />
                </div>

                <div className="param-group">
                  <span className="param-label">Recipient for spend_intent_v2 (base58)</span>
                  <input
                    placeholder={wallet.publicKey?.toBase58() ?? 'Recipient pubkey'}
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                  />
                </div>
              </div>

              <div className="action-row">
                <button disabled={!wallet.connected} onClick={onSetPolicyAdvanced}>
                  set_policy_advanced
                </button>
                <button disabled={!wallet.connected} onClick={onSpendIntentV2}>
                  spend_intent_v2
                </button>
              </div>
            </div>
          </details>
        </div>

        <div className="glass-panel">
          <h3 className="panel-header">On-chain Policy Snapshot</h3>
          <p className="demo-hint">
            Pull the current <code>Policy</code> + (optional) <code>RecipientSpend</code> accounts from devnet.
          </p>

          <div className="action-row">
            <button className="btn-secondary" disabled={!wallet.connected} onClick={fetchOnchainState}>
              fetch on-chain state
            </button>
          </div>

          {policySnapshot ? (
            <div className="addr-grid">
              <div className="addr-row">
                <span className="addr-label">policy_version</span>
                <code className="addr-value">{String(policySnapshot.policyVersion ?? '—')}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">paused</span>
                <code className="addr-value">{String(Boolean(policySnapshot.paused))}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">allowlist_enabled</span>
                <code className="addr-value">{String(Boolean(policySnapshot.allowlistEnabled))}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">allowed_recipient</span>
                <code className="addr-value">{policySnapshot.allowedRecipient ? String(policySnapshot.allowedRecipient) : '—'}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">daily_budget</span>
                <code className="addr-value">{formatLamports(policySnapshot.dailyBudgetLamports)}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">spent_today</span>
                <code className="addr-value">{formatLamports(policySnapshot.spentTodayLamports)}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">per_recipient_daily_cap</span>
                <code className="addr-value">{formatLamports(policySnapshot.perRecipientDailyCapLamports)}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">cooldown_seconds</span>
                <code className="addr-value">{String(policySnapshot.cooldownSeconds ?? '—')}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">last_spend_ts</span>
                <code className="addr-value">{String(policySnapshot.lastSpendTs ?? '—')}</code>
              </div>
              <div className="addr-row">
                <span className="addr-label">next_sequence</span>
                <code className="addr-value">{String(policySnapshot.nextSequence ?? '—')}</code>
              </div>
            </div>
          ) : (
            <p className="tx-empty">No snapshot loaded yet.</p>
          )}

          {recipientSpendSnapshot && (
            <div style={{ marginTop: 12 }}>
              <h4 className="panel-header" style={{ fontSize: 12, marginTop: 8 }}>
                RecipientSpend (for recipient field)
              </h4>
              <div className="addr-grid">
                <div className="addr-row">
                  <span className="addr-label">spent_today</span>
                  <code className="addr-value">{formatLamports(recipientSpendSnapshot.spentTodayLamports)}</code>
                </div>
                <div className="addr-row">
                  <span className="addr-label">day_index</span>
                  <code className="addr-value">{String(recipientSpendSnapshot.dayIndex ?? '—')}</code>
                </div>
              </div>
            </div>
          )}
        </div>

        {wallet.connected && (
          <div className="glass-panel">
            <h3 className="panel-header">Preflight (spend_intent_v2)</h3>
            {preflight.status === 'not_connected' || preflight.status === 'missing_snapshot' ? (
              <p className="tx-empty">Fetch on-chain state first to predict the next spend.</p>
            ) : (
              <>
                <div className="addr-grid">
                  <div className="addr-row">
                    <span className="addr-label">prediction</span>
                    <code className="addr-value">{preflight.allowed ? 'allowed' : 'denied'}</code>
                  </div>
                  <div className="addr-row">
                    <span className="addr-label">reason</span>
                    <code className="addr-value">{formatReason(preflight.reasonCode)}</code>
                  </div>
                  <div className="addr-row">
                    <span className="addr-label">remaining_budget</span>
                    <code className="addr-value">{preflight.remainingBudget !== null ? formatLamports(preflight.remainingBudget) : '—'}</code>
                  </div>
                  <div className="addr-row">
                    <span className="addr-label">remaining_recipient_cap</span>
                    <code className="addr-value">{preflight.remainingCap !== null ? formatLamports(preflight.remainingCap) : '—'}</code>
                  </div>
                </div>

                {preflight.errors.length > 0 && (
                  <ul className="preflight-errors" style={{ margin: '10px 0 0', padding: '0 0 0 1.2em', listStyle: 'disc' }}>
                    {preflight.errors.map((err) => (
                      <li key={err.code} style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-error, #f87171)' }}>
                        <strong>{err.field}:</strong> {err.message}
                      </li>
                    ))}
                  </ul>
                )}

                {preflight.recipientSnapshotMissing && (
                  <p className="demo-hint" style={{ marginTop: 10 }}>
                    RecipientSpend snapshot missing — per-recipient cap prediction may be incomplete.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="glass-panel">
          <h3 className="panel-header">Audit Trail</h3>
          <p className="demo-hint">Fetch the last 5 <code>AuditEvent</code> accounts (sequence descending).</p>

          <div className="action-row">
            <button className="btn-secondary" disabled={!wallet.connected || auditLoading} onClick={fetchRecentAuditEvents}>
              {auditLoading ? 'fetching…' : 'fetch recent audit events'}
            </button>
          </div>

          {auditEvents.length === 0 ? (
            <p className="tx-empty">No audit events loaded yet.</p>
          ) : (
            <ul className="tx-list">
              {auditEvents.map((event) => (
                <li key={event.sequence.toString()} className="tx-item" style={{ alignItems: 'flex-start' }}>
                  <span className="tx-label">#{event.sequence.toString()}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', overflow: 'hidden' }}>
                    <span>
                      allowed: {String(event.allowed)} · reason: {formatReason(event.reasonCode)} · amount:{' '}
                      {formatLamports(event.amount)}
                    </span>
                    <span className="tx-sig">recipient: {event.recipient}</span>
                    <span className="tx-sig">ts: {formatTimestamp(event.ts)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass-panel">
          <h3 className="panel-header">Transaction Log</h3>
          {logs.length === 0 ? (
            <p className="tx-empty">No transactions yet.</p>
          ) : (
            <ul className="tx-list">
              {logs.map((l) => (
                <li key={l.sig} className="tx-item">
                  <span className="tx-label">{l.label}</span>
                  <a
                    className="tx-sig"
                    href={`https://explorer.solana.com/tx/${l.sig}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {l.sig}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!wallet.connected && <p className="connect-hint">Connect a wallet to interact with PolicyVault.</p>}
      </section>

      <section className="section">
        <h2 className="section-title">Addresses</h2>
        <div className="glass-panel">
          <div className="addr-grid">
            <div className="addr-row">
              <span className="addr-label">Program</span>
              <code className="addr-value">{programId().toBase58()}</code>
              <button className="btn-ghost" onClick={() => copy(programId().toBase58())}>
                Copy
              </button>
            </div>
            <div className="addr-row">
              <span className="addr-label">Wallet</span>
              <code className="addr-value">{wallet.publicKey?.toBase58() ?? '—'}</code>
              <button
                className="btn-ghost"
                disabled={!wallet.publicKey}
                onClick={() => wallet.publicKey && copy(wallet.publicKey.toBase58())}
              >
                Copy
              </button>
            </div>
            <div className="addr-row">
              <span className="addr-label">Vault PDA</span>
              <code className="addr-value">{vaultPda ?? '—'}</code>
              <button className="btn-ghost" disabled={!vaultPda} onClick={() => vaultPda && copy(vaultPda)}>
                Copy
              </button>
            </div>
            <div className="addr-row">
              <span className="addr-label">Policy PDA</span>
              <code className="addr-value">{policyPda ?? '—'}</code>
              <button className="btn-ghost" disabled={!policyPda} onClick={() => policyPda && copy(policyPda)}>
                Copy
              </button>
            </div>
          </div>
          <div className="action-row">
            <button className="btn-secondary" disabled={!wallet.connected} onClick={refreshPdas}>
              refresh PDAs
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
