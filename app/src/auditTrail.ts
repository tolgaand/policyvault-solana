/**
 * Audit trail filtering and export utilities.
 *
 * Pure functions — no React or Anchor imports — for easy testing.
 */

import { REASON_LABELS } from './preflight'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type AuditEvent = {
  sequence: bigint
  allowed: boolean
  reasonCode: unknown
  amount: unknown
  recipient: string
  ts: unknown
}

export type AuditFilters = {
  /** 'all' | 'allowed' | 'denied' */
  status: 'all' | 'allowed' | 'denied'
  /** Substring match against recipient base58 (case-insensitive). Empty = no filter. */
  recipient: string
  /** null = all, number = match specific normalised reason code */
  reasonCode: number | null
}

/* ------------------------------------------------------------------ */
/*  Normalisation helpers                                              */
/* ------------------------------------------------------------------ */

function normalizeU16(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'object' && v && 'toNumber' in v) {
    const anyV = v as { toNumber?: () => number }
    if (typeof anyV.toNumber === 'function') return anyV.toNumber()
  }
  return null
}

function toBigInt(v: unknown): bigint | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(Math.trunc(v))
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

export { normalizeU16, toBigInt }

/* ------------------------------------------------------------------ */
/*  Filtering                                                          */
/* ------------------------------------------------------------------ */

export const DEFAULT_FILTERS: AuditFilters = {
  status: 'all',
  recipient: '',
  reasonCode: null,
}

export function filterAuditEvents(events: AuditEvent[], filters: AuditFilters): AuditEvent[] {
  return events.filter((e) => {
    // Status filter
    if (filters.status === 'allowed' && !e.allowed) return false
    if (filters.status === 'denied' && e.allowed) return false

    // Recipient substring filter (case-insensitive)
    if (filters.recipient) {
      const needle = filters.recipient.toLowerCase()
      if (!e.recipient.toLowerCase().includes(needle)) return false
    }

    // Reason code filter
    if (filters.reasonCode !== null) {
      const code = normalizeU16(e.reasonCode)
      if (code !== filters.reasonCode) return false
    }

    return true
  })
}

/** Extract unique reason codes present in an event list (for populating filter dropdown). */
export function uniqueReasonCodes(events: AuditEvent[]): number[] {
  const set = new Set<number>()
  for (const e of events) {
    const n = normalizeU16(e.reasonCode)
    if (n !== null) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

/* ------------------------------------------------------------------ */
/*  Export — CSV                                                       */
/* ------------------------------------------------------------------ */

function reasonLabel(code: unknown): string {
  const n = normalizeU16(code)
  if (n === null) return 'UNKNOWN'
  return REASON_LABELS[n] ?? 'UNKNOWN'
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const CSV_HEADERS = ['sequence', 'allowed', 'reasonCode', 'reasonLabel', 'amountLamports', 'recipient', 'ts'] as const

export function eventsToCSV(events: AuditEvent[]): string {
  const rows: string[] = [CSV_HEADERS.join(',')]
  for (const e of events) {
    const amountBi = toBigInt(e.amount)
    const tsBi = toBigInt(e.ts)
    rows.push(
      [
        e.sequence.toString(),
        e.allowed ? 'true' : 'false',
        String(normalizeU16(e.reasonCode) ?? ''),
        csvEscape(reasonLabel(e.reasonCode)),
        amountBi !== null ? amountBi.toString() : '',
        csvEscape(e.recipient),
        tsBi !== null ? tsBi.toString() : '',
      ].join(','),
    )
  }
  return rows.join('\n') + '\n'
}

/* ------------------------------------------------------------------ */
/*  Export — JSON                                                      */
/* ------------------------------------------------------------------ */

export function eventsToJSON(events: AuditEvent[]): string {
  const LAMPORTS_PER_SOL = 1_000_000_000
  const formatted = events.map((e) => {
    const amountBi = toBigInt(e.amount)
    const tsBi = toBigInt(e.ts)
    const code = normalizeU16(e.reasonCode)
    return {
      sequence: Number(e.sequence),
      allowed: e.allowed,
      reasonCode: code,
      reasonLabel: reasonLabel(e.reasonCode),
      amountLamports: amountBi !== null ? amountBi.toString() : null,
      amountSol: amountBi !== null ? Number(amountBi) / LAMPORTS_PER_SOL : null,
      recipient: e.recipient,
      ts: tsBi !== null ? Number(tsBi) : null,
      tsISO: tsBi !== null ? new Date(Number(tsBi) * 1000).toISOString() : null,
    }
  })
  return JSON.stringify(formatted, null, 2) + '\n'
}

/* ------------------------------------------------------------------ */
/*  Download helper                                                    */
/* ------------------------------------------------------------------ */

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
