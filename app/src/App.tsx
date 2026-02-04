import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'

import FlowDiagram from './FlowDiagram'
import './App.css'

const DemoRoot = lazy(() => import('./DemoRoot'))

function useDemoAutoload() {
  const [shouldLoad, setShouldLoad] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.location.hash === '#demo'
  })

  const demoRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = demoRef.current
    if (!el) return

    // Load when the demo section becomes visible.
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setShouldLoad(true)
        }
      },
      { root: null, threshold: 0.15 },
    )

    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return { shouldLoad, setShouldLoad, demoRef }
}

export default function App() {
  const { shouldLoad, setShouldLoad, demoRef } = useDemoAutoload()

  const onOpenDemo = useMemo(
    () => () => {
      setShouldLoad(true)

      const prefersReducedMotion =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false

      document
        .getElementById('demo')
        ?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
    },
    [setShouldLoad],
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1 className="topbar-title">
          PolicyVault <span className="badge">devnet</span>
        </h1>
        <button className="btn-secondary" onClick={onOpenDemo}>
          Open Demo
        </button>
      </header>

      <section className="hero">
        <div className="hero-body">
          <h2 className="hero-headline">Policy-enforced spending vaults for AI&nbsp;agents</h2>
          <p className="hero-subhead">
            Set budgets, cooldowns, and kill switches on-chain. Your agent spends within&nbsp;rules&nbsp;&mdash; or it
            doesn&rsquo;t spend at&nbsp;all.
          </p>
          <button className="btn-cta" onClick={onOpenDemo}>
            Open Demo
          </button>
        </div>
      </section>

      <main className="main-content">
        <section className="section">
          <h2 className="section-title">Core Guarantees</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <div className="feature-icon">&#9878;</div>
              <h3 className="feature-heading">Controlled Spending</h3>
              <p className="feature-text">
                Daily budgets, cooldown periods, and per-recipient caps. Your AI agent operates within strict,
                enforceable boundaries.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">&#9783;</div>
              <h3 className="feature-heading">Auditable Trail</h3>
              <p className="feature-text">
                Every request is logged on-chain &mdash; allowed or denied, with the reason recorded. Full transparency
                for every transaction.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">&#9211;</div>
              <h3 className="feature-heading">Owner Control</h3>
              <p className="feature-text">
                Update policy parameters at any time. Pause spending instantly. Optionally restrict recipients via an
                allowlist.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">How It Works</h2>
          <FlowDiagram />
        </section>

        <section
          className="section"
          ref={(el) => {
            demoRef.current = el
          }}
        >
          {shouldLoad ? (
            <Suspense
              fallback={
                <div className="glass-panel" id="demo">
                  <h2 className="section-title">Demo</h2>
                  <p className="tx-empty">Loading demo…</p>
                </div>
              }
            >
              <DemoRoot />
            </Suspense>
          ) : (
            <div className="glass-panel" id="demo">
              <h2 className="section-title">Demo</h2>
              <p className="demo-hint">
                The demo loads on demand to keep the landing page fast. Click below (or scroll a bit more) to load the
                wallet + on-chain UI.
              </p>
              <div className="action-row">
                <button className="btn-secondary" onClick={onOpenDemo}>
                  Load Demo
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
