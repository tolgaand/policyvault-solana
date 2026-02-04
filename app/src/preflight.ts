/**
 * Preflight validation pipeline for spend_intent_v2.
 *
 * Pure functions — no React or Anchor imports — so the module is
 * easy to test and can run outside a component tree.
 */

/* ------------------------------------------------------------------ */
/*  Reason codes (mirror on-chain constants)                          */
/* ------------------------------------------------------------------ */

export const REASON_CODES = {
  OK: 1,
  BUDGET_EXCEEDED: 2,
  COOLDOWN: 3,
  INVALID_AMOUNT: 4,
  PAUSED: 5,
  RECIPIENT_NOT_ALLOWED: 6,
  RECIPIENT_CAP_EXCEEDED: 7,
} as const

export const REASON_LABELS: Record<number, string> = {
  1: 'OK',
  2: 'BUDGET_EXCEEDED',
  3: 'COOLDOWN',
  4: 'INVALID_AMOUNT',
  5: 'PAUSED',
  6: 'RECIPIENT_NOT_ALLOWED',
  7: 'RECIPIENT_CAP_EXCEEDED',
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/** A single field-level validation error with an actionable message. */
export type PreflightError = {
  /** Which input field caused the error (e.g. "spendAmount", "recipient"). */
  field: string
  /** Machine-readable error code. */
  code: string
  /** Human-readable message explaining what to fix. */
  message: string
}

export type PolicySnapshot = {
  dailyBudgetLamports: bigint
  spentTodayLamports: bigint
  dayIndex: bigint
  cooldownSeconds: number
  lastSpendTs: bigint
  paused: boolean
  allowlistEnabled: boolean
  allowedRecipient: string | null
  perRecipientDailyCapLamports: bigint
}

export type RecipientSpendSnapshot = {
  spentTodayLamports: bigint
  dayIndex: bigint
}

export type PreflightInput = {
  walletConnected: boolean
  spendAmountSol: number
  recipientAddress: string
  dailyBudgetSol: number
  cooldownSeconds: number
  perRecipientCapSol: number
  paused: boolean
  allowlistEnabled: boolean
  allowedRecipient: string
  walletAddress: string | null
  policySnapshot: PolicySnapshot | null
  recipientSpendSnapshot: RecipientSpendSnapshot | null
  /** Current unix timestamp in seconds (default: Date.now()/1000). */
  nowTs?: number
}

export type PreflightResult = {
  status: 'ready' | 'not_connected' | 'missing_snapshot'
  /** True when the spend would be allowed on-chain. */
  allowed: boolean
  /** On-chain reason code (1 = OK). */
  reasonCode: number
  /** Field-level errors with actionable messages. */
  errors: PreflightError[]
  /** Remaining daily budget in lamports (null if unavailable). */
  remainingBudget: bigint | null
  /** Remaining per-recipient cap in lamports (null if unavailable). */
  remainingCap: bigint | null
  /** True when the RecipientSpend account hasn't been fetched yet. */
  recipientSnapshotMissing: boolean
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const LAMPORTS_PER_SOL = 1_000_000_000

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL))
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Cheap client-side check — does not verify the key is on-curve. */
export function isValidBase58Address(s: string): boolean {
  return BASE58_RE.test(s.trim())
}

/* ------------------------------------------------------------------ */
/*  Pipeline                                                          */
/* ------------------------------------------------------------------ */

function empty(status: 'not_connected' | 'missing_snapshot'): PreflightResult {
  return {
    status,
    allowed: false,
    reasonCode: 0,
    errors: [],
    remainingBudget: null,
    remainingCap: null,
    recipientSnapshotMissing: true,
  }
}

/**
 * Run the full preflight validation pipeline.
 *
 * Phase 1 — **field validation**: checks each input for basic correctness
 * and returns actionable errors (e.g. "Enter a spend amount greater than 0").
 *
 * Phase 2 — **policy simulation**: mirrors the on-chain spend_intent_v2
 * logic to predict whether the tx will be allowed or denied.
 */
export function runPreflight(input: PreflightInput): PreflightResult {
  if (!input.walletConnected) return empty('not_connected')
  if (!input.policySnapshot) return empty('missing_snapshot')

  const errors: PreflightError[] = []

  // ---- Phase 1: field validation ----

  // spend amount
  if (!Number.isFinite(input.spendAmountSol) || input.spendAmountSol <= 0) {
    errors.push({
      field: 'spendAmount',
      code: 'INVALID_SPEND_AMOUNT',
      message: 'Enter a spend amount greater than 0 SOL.',
    })
  } else if (input.spendAmountSol > 1_000_000) {
    errors.push({
      field: 'spendAmount',
      code: 'SPEND_AMOUNT_TOO_LARGE',
      message: 'Spend amount exceeds 1 000 000 SOL. Double-check the value.',
    })
  }

  // daily budget
  if (!Number.isFinite(input.dailyBudgetSol) || input.dailyBudgetSol <= 0) {
    errors.push({
      field: 'dailyBudget',
      code: 'INVALID_DAILY_BUDGET',
      message: 'Daily budget must be greater than 0 SOL.',
    })
  }

  // cooldown
  if (!Number.isFinite(input.cooldownSeconds) || input.cooldownSeconds < 0) {
    errors.push({
      field: 'cooldown',
      code: 'INVALID_COOLDOWN',
      message: 'Cooldown must be 0 or a positive number of seconds.',
    })
  }

  // per-recipient cap
  if (!Number.isFinite(input.perRecipientCapSol) || input.perRecipientCapSol < 0) {
    errors.push({
      field: 'perRecipientCap',
      code: 'INVALID_RECIPIENT_CAP',
      message: 'Per-recipient daily cap must be 0 or a positive SOL value.',
    })
  }

  // recipient address
  const recipientStr = (input.recipientAddress || input.walletAddress || '').trim()
  if (!recipientStr) {
    errors.push({
      field: 'recipient',
      code: 'MISSING_RECIPIENT',
      message: 'Enter a recipient address or connect a wallet to use your own address.',
    })
  } else if (!isValidBase58Address(recipientStr)) {
    errors.push({
      field: 'recipient',
      code: 'INVALID_RECIPIENT',
      message: 'Recipient is not a valid base-58 Solana address.',
    })
  }

  // allowed recipient (when allowlist is on)
  if (input.allowlistEnabled) {
    const allowedStr = (input.allowedRecipient || input.recipientAddress || input.walletAddress || '').trim()
    if (!allowedStr) {
      errors.push({
        field: 'allowedRecipient',
        code: 'MISSING_ALLOWED_RECIPIENT',
        message: 'Allowlist is enabled but no allowed recipient is set. Add one or disable the allowlist.',
      })
    } else if (!isValidBase58Address(allowedStr)) {
      errors.push({
        field: 'allowedRecipient',
        code: 'INVALID_ALLOWED_RECIPIENT',
        message: 'Allowed recipient is not a valid base-58 Solana address.',
      })
    }
  }

  // If field-level errors exist, return early — no point simulating policy.
  if (errors.length > 0) {
    return {
      status: 'ready',
      allowed: false,
      reasonCode: REASON_CODES.INVALID_AMOUNT,
      errors,
      remainingBudget: null,
      remainingCap: null,
      recipientSnapshotMissing: !input.recipientSpendSnapshot,
    }
  }

  // ---- Phase 2: policy simulation ----

  const nowTs = input.nowTs ?? Math.floor(Date.now() / 1000)
  const currentDay = BigInt(Math.floor(nowTs / 86400))
  const snap = input.policySnapshot

  const spendLamports = solToLamports(input.spendAmountSol)
  const dailyBudgetLamports = solToLamports(input.dailyBudgetSol)
  const perRecipientCapLamports = solToLamports(input.perRecipientCapSol)

  // Day rollover for policy
  const spentTodayPolicy = snap.dayIndex === currentDay ? snap.spentTodayLamports : 0n

  // Day rollover for recipient
  const recipientSnap = input.recipientSpendSnapshot
  let spentTodayRecipient: bigint | null = null
  if (recipientSnap) {
    spentTodayRecipient = recipientSnap.dayIndex === currentDay ? recipientSnap.spentTodayLamports : 0n
  }

  let allowed = true
  let reasonCode: number = REASON_CODES.OK

  // 1. amount > 0 (already validated above, but mirror on-chain)
  if (spendLamports <= 0n) {
    allowed = false
    reasonCode = REASON_CODES.INVALID_AMOUNT
  }

  // 2. paused
  if (allowed && input.paused) {
    allowed = false
    reasonCode = REASON_CODES.PAUSED
    errors.push({
      field: 'paused',
      code: 'POLICY_PAUSED',
      message: 'The vault is paused (kill switch). Unpause the policy before spending.',
    })
  }

  // 3. allowlist
  if (allowed && input.allowlistEnabled) {
    const allowedCandidate = (input.allowedRecipient || input.recipientAddress || input.walletAddress || '').trim()
    if (recipientStr !== allowedCandidate) {
      allowed = false
      reasonCode = REASON_CODES.RECIPIENT_NOT_ALLOWED
      errors.push({
        field: 'recipient',
        code: 'RECIPIENT_NOT_ON_ALLOWLIST',
        message: `Recipient ${recipientStr.slice(0, 8)}... is not the allowed address. Change the recipient or update the allowlist.`,
      })
    }
  }

  // 4. budget
  if (allowed && spendLamports + spentTodayPolicy > dailyBudgetLamports) {
    allowed = false
    reasonCode = REASON_CODES.BUDGET_EXCEEDED
    const overBy = spendLamports + spentTodayPolicy - dailyBudgetLamports
    const overSol = Number(overBy) / LAMPORTS_PER_SOL
    errors.push({
      field: 'spendAmount',
      code: 'BUDGET_EXCEEDED',
      message: `This spend exceeds the daily budget by ${overSol.toFixed(4)} SOL. Reduce the amount or wait until tomorrow.`,
    })
  }

  // 5. cooldown
  if (allowed && input.cooldownSeconds > 0) {
    const since = nowTs - Number(snap.lastSpendTs)
    if (Number.isFinite(since) && since < input.cooldownSeconds) {
      allowed = false
      reasonCode = REASON_CODES.COOLDOWN
      const wait = input.cooldownSeconds - since
      errors.push({
        field: 'cooldown',
        code: 'COOLDOWN_ACTIVE',
        message: `Cooldown active — wait ${wait} more second${wait === 1 ? '' : 's'} before the next spend.`,
      })
    }
  }

  // 6. per-recipient cap
  if (allowed && perRecipientCapLamports > 0n && spentTodayRecipient !== null) {
    if (spendLamports + spentTodayRecipient > perRecipientCapLamports) {
      allowed = false
      reasonCode = REASON_CODES.RECIPIENT_CAP_EXCEEDED
      const overBy = spendLamports + spentTodayRecipient - perRecipientCapLamports
      const overSol = Number(overBy) / LAMPORTS_PER_SOL
      errors.push({
        field: 'perRecipientCap',
        code: 'RECIPIENT_CAP_EXCEEDED',
        message: `This spend exceeds the per-recipient daily cap by ${overSol.toFixed(4)} SOL. Reduce the amount or choose a different recipient.`,
      })
    }
  }

  // Remaining computations
  const remainingBudget = dailyBudgetLamports > spentTodayPolicy ? dailyBudgetLamports - spentTodayPolicy : 0n
  const remainingCap =
    perRecipientCapLamports > 0n && spentTodayRecipient !== null
      ? perRecipientCapLamports > spentTodayRecipient
        ? perRecipientCapLamports - spentTodayRecipient
        : 0n
      : null

  return {
    status: 'ready',
    allowed,
    reasonCode,
    errors,
    remainingBudget,
    remainingCap,
    recipientSnapshotMissing: !input.recipientSpendSnapshot,
  }
}
