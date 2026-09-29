/**
 * The hero visual: one call reaching four services, and crews coming back.
 *
 * The motion is the argument, not decoration. A call lands at the centre and
 * ripples outward; routing pulses travel down four lines in sequence; each
 * service lights as it is reached; then units track back in along the same
 * lines. That is the platform's whole proposition in six seconds, and it is
 * the reason this is an animation rather than a static diagram.
 *
 * Hand-authored SVG: it stays sharp at any size, needs no image pipeline, and
 * shares its palette with the rest of the page because it is the same hex.
 */

const CX = 200;
const CY = 160;

type Service = {
  id: string;
  label: string;
  hex: string;
  /** Node centre. */
  x: number;
  y: number;
  /** Path from the incident to this service, reused by the inbound unit. */
  d: string;
  len: number;
  delay: string;
};

const SERVICES: Service[] = [
  { id: 'ems', label: 'EMS', hex: '#22c55e', x: 200, y: 48, d: 'M 200 160 L 200 48', len: 112, delay: '0s' },
  { id: 'fire', label: 'Fire & Rescue', hex: '#dc3545', x: 330, y: 160, d: 'M 200 160 L 330 160', len: 130, delay: '0.18s' },
  { id: 'metro', label: 'Metro Police', hex: '#f59e0b', x: 200, y: 272, d: 'M 200 160 L 200 272', len: 112, delay: '0.36s' },
  { id: 'disaster', label: 'Disaster Mgmt', hex: '#3b82f6', x: 70, y: 160, d: 'M 200 160 L 70 160', len: 130, delay: '0.54s' },
];

export function HeroVisual() {
  return (
    <div className="lp-visual relative mx-auto w-full max-w-[640px] overflow-hidden rounded-[22px] border border-white/10 bg-[#191b20]/90 p-4 shadow-[0_28px_80px_rgba(0,0,0,0.38)] sm:p-6">
      <div className="relative z-10 flex items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f26368]">HikTech / Live coordination</p>
          <h2 className="mt-1 text-lg font-medium tracking-tight text-white sm:text-xl">Four services. One response.</h2>
        </div>
        <span className="whitespace-nowrap rounded-full border border-[#ef454b]/25 bg-[#ef454b]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#ff777c]">4 in 1</span>
      </div>
      <svg
        viewBox="0 0 400 340"
        className="relative z-10 mx-auto h-auto w-full max-w-[540px] overflow-visible"
        role="img"
        aria-label="One emergency call routed to Metro Police, Fire and Rescue, EMS and Disaster Management, with units responding."
      >
        <defs>
          <radialGradient id="lp-core-glow">
            <stop offset="0%" stopColor="#ff5a68" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ff5a68" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Range rings — the quiet structure everything else sits on. */}
        <g fill="none" stroke="#ffffff" strokeOpacity="0.07">
          <circle cx={CX} cy={CY} r="52" />
          <circle cx={CX} cy={CY} r="86" />
          <circle cx={CX} cy={CY} r="118" />
        </g>
        <circle
          cx={CX} cy={CY} r="118" fill="none"
          stroke="#3b82f6" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="2 10"
        />

        {/* Rings leaving the centre: the call being heard. */}
        <circle className="lp-ripple" cx={CX} cy={CY} fill="none" stroke="#ff5a68" strokeWidth="1.5" />
        <circle
          className="lp-ripple" cx={CX} cy={CY} fill="none" stroke="#ff5a68" strokeWidth="1.5"
          style={{ animationDelay: '1.35s' }}
        />
        <circle
          className="lp-ripple" cx={CX} cy={CY} fill="none" stroke="#ff5a68" strokeWidth="1.5"
          style={{ animationDelay: '2.7s' }}
        />

        {/* Routing lines, their travelling pulses, and the units coming back. */}
        {SERVICES.map((s) => (
          <g key={s.id}>
            <path d={s.d} stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" fill="none" />
            <path
              className="lp-flow"
              d={s.d}
              stroke={s.hex}
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
              style={{ ['--len' as string]: s.len, animationDelay: s.delay }}
            />
            <circle
              className="lp-inbound"
              r="3.5"
              fill={s.hex}
              style={{ offsetPath: `path('${s.d}')`, animationDelay: s.delay }}
            />
          </g>
        ))}

        {/* The four services. */}
        {SERVICES.map((s) => (
          <g key={s.id} className="lp-node" style={{ animationDelay: s.delay }}>
            <circle cx={s.x} cy={s.y} r="17" fill="#05050f" stroke={s.hex} strokeOpacity="0.55" />
            <circle cx={s.x} cy={s.y} r="6" fill={s.hex} />
            <text
              x={s.x} y={s.y + 34}
              textAnchor="middle"
              fill="#ffffff"
              fillOpacity="0.62"
              fontSize="11"
              fontWeight="600"
            >
              {s.label}
            </text>
          </g>
        ))}

        {/* The incident at the centre. */}
        <circle cx={CX} cy={CY} r="40" fill="url(#lp-core-glow)" />
        <g className="lp-core">
          <circle cx={CX} cy={CY} r="15" fill="#dc3545" />
          <circle cx={CX} cy={CY} r="15" fill="none" stroke="#ff8a94" strokeOpacity="0.7" />
        </g>
        <text x={CX} y={CY + 4} textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="800">1</text>
      </svg>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4 text-[11px] text-white/45">
        <span>One call · one number · four services</span>
        <span className="inline-flex items-center gap-2 text-white/65"><span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" /> Every unit accounted for</span>
      </div>
    </div>
  );
}
