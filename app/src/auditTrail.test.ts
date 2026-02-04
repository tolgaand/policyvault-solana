import { describe, expect, it } from 'vitest'

import { eventsToCSV, eventsToJSON, filterAuditEvents, uniqueReasonCodes, type AuditEvent, DEFAULT_FILTERS } from './auditTrail'

const baseEvents: AuditEvent[] = [
  {
    sequence: 3n,
    allowed: true,
    reasonCode: 1,
    amount: 10n,
    recipient: 'AbCdEf111',
    ts: 1000n,
  },
  {
    sequence: 2n,
    allowed: false,
    reasonCode: 7,
    amount: 20n,
    recipient: 'zzYYxx222',
    ts: 2000n,
  },
  {
    sequence: 1n,
    allowed: false,
    reasonCode: 7n,
    amount: 30,
    recipient: 'something333',
    ts: null,
  },
]

describe('auditTrail filtering', () => {
  it('filters by status', () => {
    expect(filterAuditEvents(baseEvents, { ...DEFAULT_FILTERS, status: 'allowed' })).toHaveLength(1)
    expect(filterAuditEvents(baseEvents, { ...DEFAULT_FILTERS, status: 'denied' })).toHaveLength(2)
  })

  it('filters by recipient substring (case-insensitive)', () => {
    const got = filterAuditEvents(baseEvents, { ...DEFAULT_FILTERS, recipient: 'cdeF' })
    expect(got).toHaveLength(1)
    expect(got[0]?.recipient).toBe('AbCdEf111')
  })

  it('filters by reason code', () => {
    expect(filterAuditEvents(baseEvents, { ...DEFAULT_FILTERS, reasonCode: 7 })).toHaveLength(2)
    expect(filterAuditEvents(baseEvents, { ...DEFAULT_FILTERS, reasonCode: 1 })).toHaveLength(1)
  })

  it('extracts unique reason codes', () => {
    expect(uniqueReasonCodes(baseEvents)).toEqual([1, 7])
  })
})

describe('auditTrail export', () => {
  it('serializes CSV with headers and rows', () => {
    const csv = eventsToCSV(baseEvents.slice(0, 2))
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('sequence,allowed,reasonCode,reasonLabel,amountLamports,recipient,ts')
    // sequence and allowed fields
    expect(lines[1]).toContain('3,true,1,')
    expect(lines[2]).toContain('2,false,7,')
  })

  it('serializes JSON as an array with enriched fields', () => {
    const json = eventsToJSON(baseEvents.slice(0, 1))
    const arr = JSON.parse(json) as Array<Record<string, unknown>>
    expect(Array.isArray(arr)).toBe(true)
    expect(arr).toHaveLength(1)
    expect(arr[0]).toMatchObject({
      sequence: 3,
      allowed: true,
      reasonCode: 1,
      recipient: 'AbCdEf111',
      amountLamports: '10',
      ts: 1000,
    })
  })
})
