import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AuditTimeline, { type AuditTimelineEntry } from './AuditTimeline'

const fmt = (v: unknown) => String(v)

describe('AuditTimeline', () => {
  it('sorts by sequence desc and renders key fields', () => {
    const events: AuditTimelineEntry[] = [
      {
        sequence: 2n,
        allowed: false,
        reasonCode: 7,
        amount: 123n,
        recipient: '11111111111111111111111111111111',
        ts: 1000n,
      },
      {
        sequence: 5n,
        allowed: true,
        reasonCode: 1,
        amount: 999n,
        recipient: '22222222222222222222222222222222',
        ts: 2000n,
      },
    ]

    const html = renderToStaticMarkup(
      <AuditTimeline
        events={events}
        formatReason={fmt}
        formatLamports={fmt}
        formatTimestamp={fmt}
        onCopy={() => undefined}
      />,
    )

    // Ordering: #5 should appear before #2
    expect(html.indexOf('#5')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('#2')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('#5')).toBeLessThan(html.indexOf('#2'))

    // Badge text
    expect(html).toContain('allowed')
    expect(html).toContain('denied')

    // Reason and amount labels
    expect(html).toContain('reason: 1')
    expect(html).toContain('reason: 7')
    expect(html).toContain('amount')

    // Recipient + timestamp labels
    expect(html).toContain('recipient')
    expect(html).toContain('ts')
  })
})
