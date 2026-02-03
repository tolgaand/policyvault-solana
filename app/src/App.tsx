import { useMemo, useState } from 'react'
import { AnchorProvider, web3, BN } from '@coral-xyz/anchor'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

import { derivePolicyPda, deriveVaultPda, getProgram, programId } from './policyvault'
import './App.css'

type TxLog = { label: string; sig: string }

function lamports(sol: number) {
  return Math.round(sol * web3.LAMPORTS_PER_SOL)
}

export default function App() {
  const { connection } = useConnection()
  const wallet = useWallet()

  const [vaultPda, setVaultPda] = useState<string | null>(null)
  const [policyPda, setPolicyPda] = useState<string | null>(null)

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null

    // AnchorProvider expects an AnchorWallet-compatible object
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

  const pushLog = (label: string, sig: string) => setLogs((l) => [{ label, sig }, ...l])

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
    const { program, owner } = await ensureWallet()
    const [vault] = await deriveVaultPda(owner)

    const sig = await program.methods
      .initializeVault()
      .accounts({ vault, owner, systemProgram: web3.SystemProgram.programId })
      .rpc()

    pushLog('initialize_vault', sig)
    await refreshPdas()
  }

  async function onInitPolicy() {
    const { program, owner } = await ensureWallet()
    const [vault] = await deriveVaultPda(owner)
    const [policy] = await derivePolicyPda(vault)

    const sig = await program.methods
      .initializePolicy(new BN(lamports(dailyBudgetSol)), cooldownSeconds)
      .accounts({ policy, vault, authority: owner, systemProgram: web3.SystemProgram.programId })
      .rpc()

    pushLog('initialize_policy', sig)
    await refreshPdas()
  }

  async function onSetPolicy() {
    const { program, owner } = await ensureWallet()
    const [vault] = await deriveVaultPda(owner)
    const [policy] = await derivePolicyPda(vault)

    const sig = await program.methods
      .setPolicy(new BN(lamports(dailyBudgetSol)), cooldownSeconds)
      .accounts({ policy, vault, authority: owner })
      .rpc()

    pushLog('set_policy', sig)
    await refreshPdas()
  }

  async function onSpendIntent() {
    const { program, owner } = await ensureWallet()
    const [vault] = await deriveVaultPda(owner)
    const [policy] = await derivePolicyPda(vault)

    const sig = await program.methods
      .spendIntent(new BN(lamports(spendAmountSol)))
      .accounts({ vault, policy, authority: owner })
      .rpc()

    pushLog('spend_intent', sig)
    await refreshPdas()
  }

  return (
    <div className="app-shell">
      {/* ── Top bar ─────────────────────────────────── */}
      <header className="topbar">
        <h1 className="topbar-title">
          PolicyVault <span className="badge">devnet</span>
        </h1>
        <WalletMultiButton />
      </header>

      {/* ── Main ────────────────────────────────────── */}
      <main className="main-content">
        <p className="flow-hint">
          <code>initialize_vault</code> &rarr; <code>initialize_policy</code> &rarr;{' '}
          <code>spend_intent</code> / <code>set_policy</code>
        </p>

        {/* Addresses panel */}
        <section className="glass-panel">
          <h2 className="panel-header">Addresses</h2>

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
              <button
                className="btn-ghost"
                disabled={!policyPda}
                onClick={() => policyPda && copy(policyPda)}
              >
                Copy
              </button>
            </div>
          </div>

          <div className="action-row">
            <button className="btn-secondary" disabled={!wallet.connected} onClick={refreshPdas}>
              refresh PDAs
            </button>
          </div>
        </section>

        {/* Controls panel */}
        <section className="glass-panel">
          <h2 className="panel-header">Policy Parameters</h2>

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
              <input
                type="number"
                value={cooldownSeconds}
                onChange={(e) => setCooldownSeconds(Number(e.target.value))}
              />
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
        </section>

        {/* Tx log panel */}
        <section className="glass-panel">
          <h2 className="panel-header">Transaction Log</h2>
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
        </section>

        {!wallet.connected && (
          <p className="connect-hint">Connect a wallet to interact with PolicyVault.</p>
        )}
      </main>
    </div>
  )
}
