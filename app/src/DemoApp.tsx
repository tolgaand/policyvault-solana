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
import './App.css'

type TxLog = { label: string; sig: string }

const REASON_CODE: Record<number, string> = {
  1: 'OK',
  2: 'BUDGET_EXCEEDED',
  3: 'COOLDOWN',
  4: 'INVALID_AMOUNT',
  5: 'PAUSED',
  6: 'RECIPIENT_NOT_ALLOWED',
  7: 'RECIPIENT_CAP_EXCEEDED',
}

function formatReason(code: number | null | undefined) {
  if (!code) return 'UNKNOWN'
  return `${code} ${REASON_CODE[code] ?? 'UNKNOWN'}`
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

  // Advanced policy knobs (wired to set_policy_advanced + spend_intent_v2)
  const [paused, setPaused] = useState(false)
  const [allowlistEnabled, setAllowlistEnabled] = useState(false)
  const [allowedRecipient, setAllowedRecipient] = useState('')
  const [perRecipientCapSol, setPerRecipientCapSol] = useState(0.25)
  const [recipientAddress, setRecipientAddress] = useState('')

  const [uiError, setUiError] = useState<string | null>(null)

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
