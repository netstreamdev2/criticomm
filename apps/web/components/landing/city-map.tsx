/**
 * The live map panel.
 *
 * Hand-authored map geometry rather than a dot grid: a coastline, a harbour
 * bay, arterials, suburb blocks and green space, drawn in the shape of a
 * coastal metro. Units are placed *inside* the SVG and travel with
 * `offset-path` set to the road they are on, so a vehicle follows an actual
 * road at every viewport size instead of drifting across an abstract field.
 *
 * A stylised depiction of the service area, not a survey product — no tile
 * provider, no coordinates, and nothing here should be read as cartography.
 */

/* Road centrelines. Each is drawn once and reused as the offset-path of the
   unit patrolling it, so the vehicle can never leave the road. */
const ROADS = {
  m4: 'M 305 12 C 292 54 276 88 272 116 C 268 144 282 172 276 198',
  n2: 'M 26 28 C 88 52 146 78 190 104 C 224 124 246 158 252 198',
  n3: 'M 2 134 C 60 128 130 136 192 148 C 222 154 244 162 252 172',
  m13: 'M 2 72 C 68 68 136 82 196 92 C 226 97 250 104 268 112',
} as const;

const UNITS = [
  { id: 'EMS-12', hex: '#22c55e', path: ROADS.n2, dur: '17s', delay: '0s' },
  { id: 'MP-04', hex: '#f59e0b', path: ROADS.m4, dur: '14s', delay: '-6s' },
  { id: 'FR-07', hex: '#dc3545', path: ROADS.m13, dur: '19s', delay: '-11s' },
];

/** The incident sits on the M4 near the river — the storyboard's crash. */
const INCIDENT = { x: 284, y: 50 };

export function CityMap() {
  return (
    <div className="relative h-[188px] overflow-hidden rounded-lg bg-[#060614]">
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Stylised map of the service area showing three units on patrol and one active incident."
      >
        <defs>
          <linearGradient id="lp-sea" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0b1f3a" />
            <stop offset="100%" stopColor="#081527" />
          </linearGradient>
        </defs>

        {/* Land */}
        <rect width="400" height="200" fill="#080816" />

        {/* Suburb blocks — the texture that makes it read as built-up. */}
        <g fill="#ffffff" fillOpacity="0.028">
          {[
            [206, 58], [232, 58], [258, 62], [206, 80], [232, 80], [206, 100],
            [232, 102], [150, 96], [176, 92], [124, 108], [150, 122], [92, 122],
            [176, 118], [64, 100], [92, 88], [118, 76],
          ].map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="20" height="14" rx="1.5" />
          ))}
        </g>

        {/* Green space */}
        <g fill="#22c55e" fillOpacity="0.075">
          <path d="M 96 148 C 122 142 148 148 154 164 C 158 178 132 186 110 180 C 92 175 86 158 96 148 Z" />
          <path d="M 214 24 C 240 20 258 28 256 40 C 254 50 228 52 214 46 Z" />
        </g>

        {/* Ocean, then the harbour bay carved into the land */}
        <path
          d="M 400 0 L 330 0 C 316 44 296 80 292 112 C 288 142 304 170 296 200 L 400 200 Z"
          fill="url(#lp-sea)"
        />
        <path
          d="M 292 116 C 258 122 226 130 210 146 C 198 158 204 176 224 180 C 250 184 278 168 290 148 Z"
          fill="url(#lp-sea)"
        />
        {/* Shoreline */}
        <path
          d="M 330 0 C 316 44 296 80 292 112 C 288 142 304 170 296 200"
          fill="none" stroke="#3b82f6" strokeOpacity="0.32" strokeWidth="1"
        />

        {/* River */}
        <path
          d="M 60 10 C 118 28 186 38 258 44"
          fill="none" stroke="#3b82f6" strokeOpacity="0.22" strokeWidth="2.5"
        />

        {/* Minor streets */}
        <g stroke="#ffffff" strokeOpacity="0.055" strokeWidth="1">
          <path d="M 200 52 H 284 M 200 74 H 280 M 200 96 H 272 M 200 118 H 262" />
          <path d="M 216 40 V 132 M 242 40 V 130 M 268 44 V 122" />
          <path d="M 40 60 H 190 M 30 92 H 180 M 60 152 H 190" />
          <path d="M 76 40 V 168 M 116 34 V 172 M 156 44 V 166" />
        </g>

        {/* Arterials: a wide soft casing under a bright centreline reads as a
            road at small sizes far better than a single stroke. */}
        <g fill="none" strokeLinecap="round">
          {Object.values(ROADS).map((d) => (
            <path key={d} d={d} stroke="#ffffff" strokeOpacity="0.1" strokeWidth="5" />
          ))}
          {Object.values(ROADS).map((d) => (
            <path key={d} d={d} stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.4" />
          ))}
          {/* Traffic drifting along the arterials. */}
          {Object.values(ROADS).map((d) => (
            <path key={d} className="lp-traffic" d={d} stroke="#60a5fa" strokeOpacity="0.4" strokeWidth="1.4" />
          ))}
        </g>

        {/* Place names */}
        <g fill="#ffffff" fillOpacity="0.3" fontSize="7.5" fontWeight="700" letterSpacing="0.6">
          <text x="352" y="96" textAnchor="middle" fillOpacity="0.34">INDIAN OCEAN</text>
          <text x="243" y="166" textAnchor="middle">HARBOUR</text>
          <text x="300" y="30" textAnchor="middle">M4</text>
          <text x="236" y="192" textAnchor="middle">N2</text>
          <text x="20" y="128" textAnchor="middle">N3</text>
          <text x="20" y="66" textAnchor="middle">M13</text>
        </g>

        {/* Control-room sweep, anchored over the city rather than the panel. */}
        <g style={{ transformOrigin: '210px 110px' }} className="lp-sweep">
          <path d="M 210 110 L 210 -10 A 120 120 0 0 1 294 25 Z" fill="#3b82f6" fillOpacity="0.07" />
        </g>

        {/* The active incident */}
        <g>
          <circle className="lp-ripple" cx={INCIDENT.x} cy={INCIDENT.y} fill="none" stroke="#ef4444" strokeWidth="1.5" />
          <circle
            className="lp-ripple" cx={INCIDENT.x} cy={INCIDENT.y} fill="none" stroke="#ef4444" strokeWidth="1.5"
            style={{ animationDelay: '2s' }}
          />
          <circle cx={INCIDENT.x} cy={INCIDENT.y} r="4.5" fill="#ef4444" />
          <circle cx={INCIDENT.x} cy={INCIDENT.y} r="4.5" fill="none" stroke="#fff" strokeOpacity="0.85" />
        </g>

        {/* Units, each locked to the road it patrols. */}
        {UNITS.map((u) => (
          <g
            key={u.id}
            className="lp-patrol"
            style={{ offsetPath: `path('${u.path}')`, animationDuration: u.dur, animationDelay: u.delay }}
          >
            <circle r="4" fill={u.hex} stroke="#060614" strokeWidth="1.5" />
            <rect x="7" y="-6" width="34" height="12" rx="3" fill="#060614" fillOpacity="0.82" />
            <text x="24" y="3" textAnchor="middle" fill={u.hex} fontSize="8" fontWeight="700">{u.id}</text>
          </g>
        ))}
      </svg>

      {/* Panel furniture */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-[#060614] to-transparent px-3 pb-2.5 pt-6">
        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
          3 units on patrol · 1 active incident
        </span>
        <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[#4ade80]">
          <span className="lp-tick h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
          Tracking
        </span>
      </div>
    </div>
  );
}
