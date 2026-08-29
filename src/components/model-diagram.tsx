const NODES = [
  { id: 'actor', x: 40, y: 40, title: 'actor', sub: 'roles · scopes' },
  { id: 'action', x: 300, y: 40, title: 'action', sub: 'resource:verb' },
  { id: 'resource', x: 560, y: 40, title: 'resource', sub: 'records · fields' },
  { id: 'policy', x: 20, y: 200, title: 'policy', sub: 'permit · scope · deny' },
  { id: 'workflow', x: 200, y: 200, title: 'workflow', sub: 'states · countersign' },
  { id: 'audit', x: 380, y: 200, title: 'audit', sub: 'hash-chained events' },
  { id: 'connector', x: 560, y: 200, title: 'connector', sub: 'typed port · outbox' },
] as const;

const W = 160;
const H = 54;

/**
 * The object model, drawn from the same six nouns the substrate is built out of. It is a
 * fixed picture rather than a generated one: what varies per deployment is which resources
 * are registered against the model, and that is the table underneath.
 */
export function ModelDiagram() {
  return (
    <svg
      viewBox="0 0 760 300"
      className="w-full rounded-lg border border-neutral-200 bg-[radial-gradient(var(--color-neutral-300)_1px,transparent_1px)] [background-size:16px_16px]"
      role="img"
      aria-label="actor performs action on resource, constrained by policy and workflow, recorded by audit, carried out through a connector"
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className="fill-neutral-400" />
        </marker>
      </defs>

      <g className="stroke-neutral-400" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)">
        <path d="M200,67 H296" />
        <path d="M460,67 H556" />
        <path d="M100,200 V150 Q100,130 125,130 H330 V98" />
        <path d="M280,200 V162 Q280,142 305,142 H370 V98" />
        <path d="M400,96 V142 Q400,162 425,162 H460 V196" />
        <path d="M440,96 V122 Q440,142 465,142 H640 V196" />
      </g>

      <g className="fill-neutral-500 text-[11px]" style={{ fontSize: 11 }}>
        <text x="212" y="60">performs</text>
        <text x="472" y="60">on</text>
        <text x="108" y="126">constrains</text>
        <text x="288" y="138">constrains</text>
        <text x="330" y="180">records</text>
        <text x="470" y="136">effects, after commit</text>
      </g>

      {NODES.map((node) => (
        <g key={node.id}>
          <rect
            x={node.x}
            y={node.y}
            width={W}
            height={H}
            rx={8}
            className="fill-white stroke-neutral-300"
            strokeWidth="1"
          />
          <text
            x={node.x + 14}
            y={node.y + 23}
            className="fill-neutral-900 font-semibold"
            style={{ fontSize: 13 }}
          >
            {node.title}
          </text>
          <text x={node.x + 14} y={node.y + 40} className="fill-neutral-500" style={{ fontSize: 11 }}>
            {node.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}
