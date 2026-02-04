import './FlowDiagram.css'

const nodes = [
  { id: 'agent', label: 'Agent', x: 300, y: 40, w: 140, h: 44 },
  { id: 'request', label: 'Spending Request', x: 300, y: 130, w: 170, h: 44 },
  { id: 'check', label: 'Policy Check', x: 300, y: 240, w: 0, h: 0 }, // diamond
  { id: 'transfer', label: 'Transfer', x: 140, y: 360, w: 130, h: 44 },
  { id: 'denied', label: 'Reason + Log', x: 460, y: 360, w: 140, h: 44 },
  { id: 'audit', label: 'Audit Log', x: 300, y: 470, w: 140, h: 44 },
] as const

export default function FlowDiagram() {
  return (
    <div
      className="flow-diagram"
      role="img"
      aria-label="PolicyVault flow diagram: an agent sends a spending request, which goes through a policy check. If allowed, the transfer executes. If denied, the reason is logged. Both paths feed into the audit log."
    >
      <svg
        viewBox="0 60 600 440"
        xmlns="http://www.w3.org/2000/svg"
        className="flow-svg"
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        <title>PolicyVault flow diagram</title>
        <desc>
          Agent submits a spending request, then a policy check either allows a transfer or denies with a reason. Both are
          recorded in an audit log.
        </desc>
        <defs>
          {/* animated dash pattern */}
          <pattern id="flow-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(0,255,255,0.04)" strokeWidth="0.5" />
          </pattern>

          {/* arrowheads */}
          <marker id="arrow-cyan" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--neon-cyan)" opacity="0.75" />
          </marker>
          <marker id="arrow-allowed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f6" opacity="0.85" />
          </marker>
          <marker id="arrow-denied" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--neon-magenta)" opacity="0.85" />
          </marker>

          {/* neon glow filters */}
          <filter id="glow-cyan" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-magenta" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* subtle grid bg */}
        <rect width="600" height="500" fill="url(#flow-grid)" />

        {/* ── Edges ─────────────────────────────────── */}
        {/* Agent -> Request */}
        <line x1="300" y1="82" x2="300" y2="108" className="flow-edge" markerEnd="url(#arrow-cyan)" />
        {/* Request -> Check */}
        <line x1="300" y1="152" x2="300" y2="205" className="flow-edge" markerEnd="url(#arrow-cyan)" />
        {/* Check -> Transfer (allowed) */}
        <polyline points="265,240 140,340" className="flow-edge flow-edge--allowed" markerEnd="url(#arrow-allowed)" />
        {/* Check -> Denied */}
        <polyline points="335,240 460,340" className="flow-edge flow-edge--denied" markerEnd="url(#arrow-denied)" />
        {/* Transfer -> Audit */}
        <polyline points="140,382 300,448" className="flow-edge" markerEnd="url(#arrow-cyan)" />
        {/* Denied -> Audit */}
        <polyline points="460,382 300,448" className="flow-edge" markerEnd="url(#arrow-cyan)" />

        {/* branch labels */}
        <text x="190" y="280" className="flow-branch-label flow-branch-label--allowed">Allowed</text>
        <text x="380" y="280" className="flow-branch-label flow-branch-label--denied">Denied</text>

        {/* ── Nodes ─────────────────────────────────── */}
        {/* Agent */}
        <g className="flow-node" aria-label="Agent: the AI agent that initiates spending">
          <title>Agent</title>
          <desc>The AI agent that initiates spending.</desc>
          <rect
            x={nodes[0].x - nodes[0].w / 2}
            y={nodes[0].y - nodes[0].h / 2}
            width={nodes[0].w}
            height={nodes[0].h}
            rx="4"
            className="flow-node-rect flow-node-rect--agent"
          />
          <text x={nodes[0].x} y={nodes[0].y + 5} className="flow-node-text">
            {nodes[0].label}
          </text>
        </g>

        {/* Spending Request */}
        <g className="flow-node" aria-label="Spending Request: the agent submits a spend intent">
          <title>Spending Request</title>
          <desc>The agent submits a spend intent.</desc>
          <rect
            x={nodes[1].x - nodes[1].w / 2}
            y={nodes[1].y - nodes[1].h / 2}
            width={nodes[1].w}
            height={nodes[1].h}
            rx="4"
            className="flow-node-rect"
          />
          <text x={nodes[1].x} y={nodes[1].y + 5} className="flow-node-text">
            {nodes[1].label}
          </text>
        </g>

        {/* Policy Check (diamond) */}
        <g
          className="flow-node flow-node--decision"
          aria-label="Policy Check: validates the request against budget, cooldown, pause, allowlist, and per-recipient cap rules"
        >
          <title>Policy Check</title>
          <desc>Validates the request against budget, cooldown, pause, allowlist, and per-recipient cap rules.</desc>
          <polygon points="300,200 345,240 300,280 255,240" className="flow-node-diamond" />
          <text x="300" y="244" className="flow-node-text flow-node-text--decision">
            {nodes[2].label}
          </text>
        </g>

        {/* Transfer (allowed) */}
        <g className="flow-node" aria-label="Transfer: SOL is transferred from the vault">
          <title>Transfer</title>
          <desc>SOL is transferred from the vault to the recipient.</desc>
          <rect
            x={nodes[3].x - nodes[3].w / 2}
            y={nodes[3].y - nodes[3].h / 2}
            width={nodes[3].w}
            height={nodes[3].h}
            rx="4"
            className="flow-node-rect flow-node-rect--allowed"
          />
          <text x={nodes[3].x} y={nodes[3].y + 5} className="flow-node-text">
            {nodes[3].label}
          </text>
        </g>

        {/* Denied (Reason + Log) */}
        <g className="flow-node" aria-label="Reason and Log: the denial reason is recorded">
          <title>Reason + Log</title>
          <desc>The denial reason is recorded in the audit trail.</desc>
          <rect
            x={nodes[4].x - nodes[4].w / 2}
            y={nodes[4].y - nodes[4].h / 2}
            width={nodes[4].w}
            height={nodes[4].h}
            rx="4"
            className="flow-node-rect flow-node-rect--denied"
          />
          <text x={nodes[4].x} y={nodes[4].y + 5} className="flow-node-text">
            {nodes[4].label}
          </text>
        </g>

        {/* Audit Log */}
        <g className="flow-node" aria-label="Audit Log: all transactions are recorded on-chain">
          <title>Audit Log</title>
          <desc>All transactions are recorded on-chain.</desc>
          <rect
            x={nodes[5].x - nodes[5].w / 2}
            y={nodes[5].y - nodes[5].h / 2}
            width={nodes[5].w}
            height={nodes[5].h}
            rx="4"
            className="flow-node-rect flow-node-rect--audit"
          />
          <text x={nodes[5].x} y={nodes[5].y + 5} className="flow-node-text">
            {nodes[5].label}
          </text>
        </g>
      </svg>
    </div>
  )
}
