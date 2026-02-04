import { describe, it, expect } from 'vitest'
import {
  runPreflight,
  REASON_CODES,
  solToLamports,
  isValidBase58Address,
  type PreflightInput,
  type PolicySnapshot,
  type RecipientSpendSnapshot,
} from './preflight'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const WALLET = 'BPFLoaderUpgradeab1e11111111111111111111111'
const RECIPIENT = '11111111111111111111111111111112'

const NOW_TS = 1_800_000_000 // a stable "now"
const CURRENT_DAY = BigInt(Math.floor(NOW_TS / 86400))

function makeSnapshot(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    dailyBudgetLamports: solToLamports(1),
    spentTodayLamports: 0n,
    dayIndex: CURRENT_DAY,
    cooldownSeconds: 0,
    lastSpendTs: 0n,
    paused: false,
    allowlistEnabled: false,
    allowedRecipient: null,
    perRecipientDailyCapLamports: 0n,
    ...overrides,
  }
}

function makeRecipientSnap(overrides: Partial<RecipientSpendSnapshot> = {}): RecipientSpendSnapshot {
  return {
    spentTodayLamports: 0n,
    dayIndex: CURRENT_DAY,
    ...overrides,
  }
}

function makeInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    walletConnected: true,
    spendAmountSol: 0.1,
    recipientAddress: RECIPIENT,
    dailyBudgetSol: 1,
    cooldownSeconds: 0,
    perRecipientCapSol: 0,
    paused: false,
    allowlistEnabled: false,
    allowedRecipient: '',
    walletAddress: WALLET,
    policySnapshot: makeSnapshot(),
    recipientSpendSnapshot: null,
    nowTs: NOW_TS,
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/*  Unit: isValidBase58Address                                        */
/* ------------------------------------------------------------------ */

describe('isValidBase58Address', () => {
  it('accepts a valid Solana pubkey', () => {
    expect(isValidBase58Address(WALLET)).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidBase58Address('')).toBe(false)
  })

  it('rejects address with invalid chars (0, O, I, l)', () => {
    expect(isValidBase58Address('0OIl' + 'a'.repeat(40))).toBe(false)
  })

  it('rejects too-short string', () => {
    expect(isValidBase58Address('abc')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  Unit: solToLamports                                               */
/* ------------------------------------------------------------------ */

describe('solToLamports', () => {
  it('converts 1 SOL correctly', () => {
    expect(solToLamports(1)).toBe(1_000_000_000n)
  })

  it('handles fractional SOL', () => {
    expect(solToLamports(0.5)).toBe(500_000_000n)
  })
})

/* ------------------------------------------------------------------ */
/*  Pre-conditions                                                    */
/* ------------------------------------------------------------------ */

describe('runPreflight — pre-conditions', () => {
  it('returns not_connected when wallet disconnected', () => {
    const res = runPreflight(makeInput({ walletConnected: false }))
    expect(res.status).toBe('not_connected')
    expect(res.allowed).toBe(false)
  })

  it('returns missing_snapshot when policy not loaded', () => {
    const res = runPreflight(makeInput({ policySnapshot: null }))
    expect(res.status).toBe('missing_snapshot')
  })
})

/* ------------------------------------------------------------------ */
/*  Phase 1: field validation                                         */
/* ------------------------------------------------------------------ */

describe('runPreflight — field validation', () => {
  it('rejects spend amount of 0', () => {
    const res = runPreflight(makeInput({ spendAmountSol: 0 }))
    expect(res.allowed).toBe(false)
    const err = res.errors.find((e) => e.field === 'spendAmount')
    expect(err).toBeDefined()
    expect(err!.code).toBe('INVALID_SPEND_AMOUNT')
    expect(err!.message).toContain('greater than 0')
  })

  it('rejects negative spend amount', () => {
    const res = runPreflight(makeInput({ spendAmountSol: -5 }))
    expect(res.errors.find((e) => e.code === 'INVALID_SPEND_AMOUNT')).toBeDefined()
  })

  it('rejects NaN spend amount', () => {
    const res = runPreflight(makeInput({ spendAmountSol: NaN }))
    expect(res.errors.find((e) => e.code === 'INVALID_SPEND_AMOUNT')).toBeDefined()
  })

  it('warns on absurdly large spend', () => {
    const res = runPreflight(makeInput({ spendAmountSol: 2_000_000, dailyBudgetSol: 3_000_000 }))
    expect(res.errors.find((e) => e.code === 'SPEND_AMOUNT_TOO_LARGE')).toBeDefined()
  })

  it('rejects invalid daily budget', () => {
    const res = runPreflight(makeInput({ dailyBudgetSol: 0 }))
    expect(res.errors.find((e) => e.code === 'INVALID_DAILY_BUDGET')).toBeDefined()
  })

  it('rejects negative cooldown', () => {
    const res = runPreflight(makeInput({ cooldownSeconds: -1 }))
    expect(res.errors.find((e) => e.code === 'INVALID_COOLDOWN')).toBeDefined()
  })

  it('rejects negative per-recipient cap', () => {
    const res = runPreflight(makeInput({ perRecipientCapSol: -0.5 }))
    expect(res.errors.find((e) => e.code === 'INVALID_RECIPIENT_CAP')).toBeDefined()
  })

  it('rejects missing recipient when wallet also missing', () => {
    const res = runPreflight(makeInput({ recipientAddress: '', walletAddress: null }))
    expect(res.errors.find((e) => e.code === 'MISSING_RECIPIENT')).toBeDefined()
    expect(res.errors[0].message).toContain('Enter a recipient')
  })

  it('rejects invalid base58 recipient', () => {
    const res = runPreflight(makeInput({ recipientAddress: 'not-a-pubkey!!!' }))
    expect(res.errors.find((e) => e.code === 'INVALID_RECIPIENT')).toBeDefined()
  })

  it('rejects missing allowed recipient when allowlist enabled', () => {
    const res = runPreflight(
      makeInput({ allowlistEnabled: true, allowedRecipient: '', recipientAddress: '', walletAddress: null }),
    )
    expect(res.errors.find((e) => e.code === 'MISSING_ALLOWED_RECIPIENT')).toBeDefined()
  })

  it('rejects invalid allowed recipient address', () => {
    const res = runPreflight(
      makeInput({ allowlistEnabled: true, allowedRecipient: 'bad!', recipientAddress: RECIPIENT }),
    )
    expect(res.errors.find((e) => e.code === 'INVALID_ALLOWED_RECIPIENT')).toBeDefined()
  })

  it('returns early with all field errors before policy simulation', () => {
    const res = runPreflight(makeInput({ spendAmountSol: -1, recipientAddress: 'xxx', dailyBudgetSol: -1 }))
    expect(res.errors.length).toBeGreaterThanOrEqual(3)
    // Should not have policy-level errors like PAUSED/BUDGET since we short-circuit
    expect(res.errors.every((e) => !['POLICY_PAUSED', 'BUDGET_EXCEEDED'].includes(e.code))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  Phase 2: policy simulation                                        */
/* ------------------------------------------------------------------ */

describe('runPreflight — policy simulation', () => {
  it('allows a valid spend within budget', () => {
    const res = runPreflight(makeInput())
    expect(res.status).toBe('ready')
    expect(res.allowed).toBe(true)
    expect(res.reasonCode).toBe(REASON_CODES.OK)
    expect(res.errors).toHaveLength(0)
  })

  it('denies when paused', () => {
    const res = runPreflight(makeInput({ paused: true }))
    expect(res.allowed).toBe(false)
    expect(res.reasonCode).toBe(REASON_CODES.PAUSED)
    expect(res.errors.find((e) => e.code === 'POLICY_PAUSED')).toBeDefined()
    expect(res.errors[0].message).toContain('Unpause')
  })

  it('denies when budget exceeded', () => {
    const snap = makeSnapshot({ spentTodayLamports: solToLamports(0.95) })
    const res = runPreflight(makeInput({ policySnapshot: snap }))
    expect(res.allowed).toBe(false)
    expect(res.reasonCode).toBe(REASON_CODES.BUDGET_EXCEEDED)
    expect(res.errors.find((e) => e.code === 'BUDGET_EXCEEDED')).toBeDefined()
    expect(res.errors[0].message).toContain('Reduce the amount')
  })

  it('denies during cooldown', () => {
    const snap = makeSnapshot({ cooldownSeconds: 60, lastSpendTs: BigInt(NOW_TS - 30) })
    const res = runPreflight(makeInput({ policySnapshot: snap, cooldownSeconds: 60 }))
    expect(res.allowed).toBe(false)
    expect(res.reasonCode).toBe(REASON_CODES.COOLDOWN)
    expect(res.errors.find((e) => e.code === 'COOLDOWN_ACTIVE')).toBeDefined()
    expect(res.errors[0].message).toContain('30 more seconds')
  })

  it('denies when recipient not on allowlist', () => {
    const snap = makeSnapshot({ allowlistEnabled: true, allowedRecipient: WALLET })
    const res = runPreflight(
      makeInput({ policySnapshot: snap, allowlistEnabled: true, allowedRecipient: WALLET, recipientAddress: RECIPIENT }),
    )
    expect(res.allowed).toBe(false)
    expect(res.reasonCode).toBe(REASON_CODES.RECIPIENT_NOT_ALLOWED)
    expect(res.errors.find((e) => e.code === 'RECIPIENT_NOT_ON_ALLOWLIST')).toBeDefined()
  })

  it('allows when recipient matches allowlist', () => {
    const snap = makeSnapshot({ allowlistEnabled: true, allowedRecipient: RECIPIENT })
    const res = runPreflight(
      makeInput({ policySnapshot: snap, allowlistEnabled: true, allowedRecipient: RECIPIENT, recipientAddress: RECIPIENT }),
    )
    expect(res.allowed).toBe(true)
  })

  it('denies when per-recipient cap exceeded', () => {
    const snap = makeSnapshot({ perRecipientDailyCapLamports: solToLamports(0.2) })
    const recSnap = makeRecipientSnap({ spentTodayLamports: solToLamports(0.15) })
    const res = runPreflight(
      makeInput({
        policySnapshot: snap,
        recipientSpendSnapshot: recSnap,
        perRecipientCapSol: 0.2,
      }),
    )
    expect(res.allowed).toBe(false)
    expect(res.reasonCode).toBe(REASON_CODES.RECIPIENT_CAP_EXCEEDED)
    expect(res.errors.find((e) => e.code === 'RECIPIENT_CAP_EXCEEDED')).toBeDefined()
  })

  it('resets spent_today on day rollover', () => {
    const snap = makeSnapshot({
      spentTodayLamports: solToLamports(0.95),
      dayIndex: CURRENT_DAY - 1n, // yesterday
    })
    const res = runPreflight(makeInput({ policySnapshot: snap }))
    expect(res.allowed).toBe(true) // budget resets to 0 spent
    expect(res.remainingBudget).toBe(solToLamports(1)) // full budget after rollover
  })

  it('reports remaining budget correctly', () => {
    const snap = makeSnapshot({ spentTodayLamports: solToLamports(0.3) })
    const res = runPreflight(makeInput({ policySnapshot: snap }))
    expect(res.remainingBudget).toBe(solToLamports(0.7))
  })

  it('reports remaining cap correctly', () => {
    const recSnap = makeRecipientSnap({ spentTodayLamports: solToLamports(0.05) })
    const res = runPreflight(
      makeInput({
        recipientSpendSnapshot: recSnap,
        perRecipientCapSol: 0.25,
      }),
    )
    expect(res.remainingCap).toBe(solToLamports(0.2))
  })

  it('marks recipientSnapshotMissing when not provided', () => {
    const res = runPreflight(makeInput({ recipientSpendSnapshot: null }))
    expect(res.recipientSnapshotMissing).toBe(true)
  })

  it('marks recipientSnapshotMissing false when provided', () => {
    const res = runPreflight(makeInput({ recipientSpendSnapshot: makeRecipientSnap() }))
    expect(res.recipientSnapshotMissing).toBe(false)
  })
})
