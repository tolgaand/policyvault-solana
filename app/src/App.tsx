import { useMemo, useState } from 'react'
import { AnchorProvider, web3, BN } from '@coral-xyz/anchor'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

import { derivePolicyPda, deriveVaultPda, getProgram, programId } from './policyvault'
import FlowDiagram from './FlowDiagram'
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
      .initializePolicy(new BN(lamports(dailyBudgetSol)), cooldownSeconds, null)
      .accounts({ policy, vault, owner, systemProgram: web3.SystemProgram.programId })
      .rpc()

    pushLog('initialize_policy', sig)
    await refreshPdas()
  }

  async function onSetPolicy() {
    const { program, owner } = await ensureWallet()
    const [vault] = await deriveVaultPda(owner)
    const [policy] = await derivePolicyPda(vault)

    const sig = await program.methods
      .setPolicy(new BN(lamports(dailyBudgetSol)), cooldownSeconds, null)
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
      .accounts({ vault, policy, recipient: owner, caller: owner, systemProgram: web3.SystemProgram.programId })
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

      {/* ── Hero ──────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-banner">
          <img
            src="/assets/policyvault-banner.jpeg"
            alt="PolicyVault banner"
            className="hero-img"
          />
          <div className="hero-overlay" />
        </div>
        <div className="hero-body">
          <h2 className="hero-headline">
            Policy-enforced spending vaults for AI&nbsp;agents
          </h2>
          <p className="hero-subhead">
            Set budgets, cooldowns, and kill switches on-chain. Your agent spends
            within&nbsp;rules&nbsp;&mdash; or it doesn&rsquo;t spend at&nbsp;all.
          </p>
          <a href="#demo" className="btn-cta">
            Open Demo
          </a>
        </div>
      </section>

      <main className="main-content">
        {/* ── Features ────────────────────────────────── */}
        <section className="section">
          <h2 className="section-title">Core Guarantees</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <div className="feature-icon">&#9878;</div>
              <h3 className="feature-heading">Controlled Spending</h3>
              <p className="feature-text">
                Daily budgets, cooldown periods, and approval requirements.
                Your AI agent operates within strict, enforceable boundaries.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">&#9783;</div>
              <h3 className="feature-heading">Auditable Trail</h3>
              <p className="feature-text">
                Every request is logged on-chain &mdash; allowed or denied, with
                the reason recorded. Full transparency for every transaction.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">&#9211;</div>
              <h3 className="feature-heading">Owner Control</h3>
              <p className="feature-text">
                Update policy parameters at any time. Revoke access instantly.
              </p>
              <span className="coming-soon">Kill switch &mdash; coming soon</span>
            </div>
          </div>
        </section>

        {/* ── How It Works ────────────────────────────── */}
        <section className="section">
          <h2 className="section-title">How It Works</h2>
          <FlowDiagram />
        </section>

        {/* ── Demo ────────────────────────────────────── */}
        <section className="section" id="demo">
          <h2 className="section-title">Demo</h2>
          <p className="demo-hint">
            <code>initialize_vault</code> &rarr; <code>initialize_policy</code> &rarr;{' '}
            <code>spend_intent</code> / <code>set_policy</code>
          </p>

          {/* Controls */}
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
          </div>

          {/* Tx log */}
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

          {!wallet.connected && (
            <p className="connect-hint">Connect a wallet to interact with PolicyVault.</p>
          )}
        </section>

        {/* ── Addresses ───────────────────────────────── */}
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
          </div>
        </section>
      </main>
    </div>
  )
}
