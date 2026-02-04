export type AuditTimelineEntry = {
  sequence: bigint
  allowed: boolean
  reasonCode: unknown
  amount: unknown
  recipient: string
  ts: unknown
}

type FormatFn = (v: unknown) => string

type Props = {
  events: AuditTimelineEntry[]
  formatReason: FormatFn
  formatLamports: FormatFn
  formatTimestamp: FormatFn
  onCopy?: (text: string) => void | Promise<void>
}

function shortenPk(pk: string, head = 6, tail = 6) {
  const s = (pk || '').trim()
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

export default function AuditTimeline({ events, formatReason, formatLamports, formatTimestamp, onCopy }: Props) {
  const sorted = [...events].sort((a, b) => (a.sequence > b.sequence ? -1 : a.sequence < b.sequence ? 1 : 0))

  return (
    <div className="audit-timeline" role="list">
      {sorted.map((event) => {
        const seq = event.sequence.toString()
        const allowed = Boolean(event.allowed)
        const badgeClass = allowed ? 'audit-badge audit-badge--allow' : 'audit-badge audit-badge--deny'

        return (
          <div key={seq} className="audit-item" role="listitem">
            <div className="audit-marker" aria-hidden="true" />

            <div className="audit-card">
              <div className="audit-header">
                <span className="audit-seq">#{seq}</span>
                <span className={badgeClass}>{allowed ? 'allowed' : 'denied'}</span>
                <span className="audit-reason">reason: {formatReason(event.reasonCode)}</span>
              </div>

              <div className="audit-meta">
                <div className="audit-meta-row">
                  <span className="audit-meta-label">amount</span>
                  <span className="audit-meta-value">{formatLamports(event.amount)}</span>
                </div>
                <div className="audit-meta-row">
                  <span className="audit-meta-label">recipient</span>
                  <span className="audit-meta-value">
                    <code className="audit-pk" title={event.recipient}>
                      {shortenPk(event.recipient)}
                    </code>
                    {onCopy && (
                      <button className="btn-ghost btn-ghost--tiny" onClick={() => onCopy(event.recipient)} type="button">
                        Copy
                      </button>
                    )}
                  </span>
                </div>
                <div className="audit-meta-row">
                  <span className="audit-meta-label">ts</span>
                  <span className="audit-meta-value">{formatTimestamp(event.ts)}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
