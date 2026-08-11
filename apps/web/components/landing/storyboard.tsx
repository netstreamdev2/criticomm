/**
 * The storyboard: one incident, beat by beat, with the minute each step saves.
 *
 * A composed scenario rather than a real incident — and it says so on the page.
 * Every capability described is one the platform actually has; the crash, the
 * times and the crews are illustration, and presenting illustration as a real
 * record would be the one thing a system of record must never do.
 *
 * Server component, no client JavaScript.
 */

type Beat = {
  time: string;
  phase: 'Control room' | 'Field' | 'Case file';
  title: string;
  /** What is happening in the world — the part with people in it. */
  world: string;
  /** What the platform does at that moment. */
  system: string;
  /** Why it matters. This is the whole point of the section. */
  saves: string;
};

const TONE = {
  'Control room': '#dc3545',
  Field: '#3b82f6',
  'Case file': '#22c55e',
} as const;

const BEATS: Beat[] = [
  {
    time: '19:42:06',
    phase: 'Control room',
    title: 'The call lands',
    world: 'A taxi has rolled on the M4 near Umgeni. The caller is shouting and does not know the road name.',
    system: 'The call-taker types while the caller speaks and drops the location straight onto the map, instead of spelling out a street name letter by letter.',
    saves: 'Seconds at the very front of the call — the only seconds still ahead of the entire response.',
  },
  {
    time: '19:42:31',
    phase: 'Control room',
    title: 'Four calls, one crash',
    world: 'Three more people call in the next ninety seconds. Every one of them is describing the same vehicles.',
    system: 'Duplicate detection matches the location, the time and the type, and offers the incident that already exists instead of opening a new one.',
    saves: 'Three crews are not sent to a scene that already has one. They stay free for the next emergency — which is where the life saved is usually somebody else’s.',
  },
  {
    time: '19:42:48',
    phase: 'Control room',
    title: 'One number, three departments',
    world: 'Entrapment, fuel across two lanes, traffic still moving. This is not one service’s job.',
    system: 'The incident is numbered once and routed to EMS, Fire and Metro Police in a single action. All three write into the same file from that moment on.',
    saves: 'No second phone call to a second control room, and no waiting for one service to think to tell another.',
  },
  {
    time: '19:43:02',
    phase: 'Field',
    title: 'The phones go off in the vehicles',
    world: 'The nearest crews are mid-shift — parked, eating, driving with the window down.',
    system: 'The assignment reaches the handsets as a push notification and a full-screen interrupt that a locked phone still shows.',
    saves: 'Being told does not depend on someone hearing a radio call over traffic and an idling engine.',
  },
  {
    time: '19:44:10',
    phase: 'Field',
    title: 'Accepted, and rolling',
    world: 'A crew accepts and pulls out.',
    system: 'The status flips to En Route and the vehicle’s position goes live on the control-room map.',
    saves: 'Dispatch stops guessing where anyone is, so the next call goes to the genuinely nearest unit rather than the one that answered first.',
  },
  {
    time: '19:49:30',
    phase: 'Field',
    title: 'On scene — stamped from the scene',
    world: 'The crew arrives under a bridge with no usable signal, and starts work immediately.',
    system: 'On Scene is written to the handset the instant it is pressed and delivered when coverage returns, carrying the time it happened rather than the time it was sent.',
    saves: 'The response-time record is the truth. Reviews, inquests and public accountability all turn on this one number.',
  },
  {
    time: '19:52:00',
    phase: 'Field',
    title: 'The record writes itself',
    world: 'Everyone is working. Nobody has a spare hand for paperwork.',
    system: 'Photographs, voice notes and patient observations are captured on the phone and queue themselves. The officer-down button stays one press away the entire time.',
    saves: 'Evidence is captured while it still exists — a cleared scene cannot be photographed an hour later.',
  },
  {
    time: '20:31:00',
    phase: 'Case file',
    title: 'Closed with everything already in it',
    world: 'Patient handed over at the receiving hospital. The road reopens.',
    system: 'The department’s report is completed against a file that already holds every time, position, status change and piece of evidence.',
    saves: 'Nothing is reconstructed from memory a week later, because nothing had to be.',
  },
];

export function Storyboard() {
  return (
    <div className="mt-14">
      {/* Phase legend */}
      <div className="mb-10 flex flex-wrap items-center gap-x-5 gap-y-2">
        {(Object.keys(TONE) as Array<keyof typeof TONE>).map((k) => (
          <span key={k} className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
            <span className="h-2 w-2 rounded-full" style={{ background: TONE[k] }} />
            {k}
          </span>
        ))}
      </div>

      <ol className="relative space-y-4">
        {/* The spine. Hidden on small screens, where the cards stack instead. */}
        <span aria-hidden className="absolute left-[92px] top-3 hidden h-[calc(100%-2rem)] w-px bg-gradient-to-b from-[#dc3545] via-[#3b82f6] to-[#22c55e] lg:block" />

        {BEATS.map((b) => (
          <li key={b.time} className="relative lg:pl-[124px]">
            {/* Time + node */}
            <div className="mb-2 flex items-center gap-3 lg:absolute lg:left-0 lg:top-6 lg:mb-0 lg:w-[92px] lg:justify-end lg:gap-0">
              <span className="font-mono text-sm font-semibold tabular-nums text-white/80 lg:pr-4">{b.time}</span>
              <span
                aria-hidden
                className="hidden h-3 w-3 shrink-0 rounded-full ring-4 ring-[#05050f] lg:block lg:absolute lg:-right-[6px] lg:top-1"
                style={{ background: TONE[b.phase] }}
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:bg-white/[0.055]">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-lg font-bold">{b.title}</h3>
                <span
                  className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: `${TONE[b.phase]}22`, color: TONE[b.phase] }}
                >
                  {b.phase}
                </span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-white/55">{b.world}</p>
              <p className="mt-3 text-sm leading-relaxed text-white/85">{b.system}</p>

              <p className="mt-4 flex gap-3 border-t border-white/10 pt-4 text-sm leading-relaxed">
                <span className="shrink-0 font-bold" style={{ color: TONE[b.phase] }}>Why it matters</span>
                <span className="text-white/70">{b.saves}</span>
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-white/65">
        <span className="font-semibold text-white">Forty-nine minutes, one file.</span>{' '}
        No part of this depends on anyone remembering to write something down, and no part of it stops
        working when the signal does. That is the entire argument: in an emergency service the minutes
        are won at the seams — between the caller and the desk, between one department and another,
        between the scene and the record — and those are exactly the places a single platform removes.
      </p>
    </div>
  );
}
