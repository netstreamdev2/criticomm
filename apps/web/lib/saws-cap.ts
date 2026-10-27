/**
 * The SA Weather Service's public warning feed, read for eThekwini (0116).
 *
 * SAWS lists every warning file on an RSS feed
 * (https://caps.weathersa.co.za/Home/RssFeed); each file is one CAP 1.2
 * alert for a province: KZN_CAP_SevereThunderstorms_20261026_081911.xml.
 * One file can hold several <info> blocks, each a level for some areas
 * ("Warning Level 4" here, "Warning Level 2" there). Files carry no link to
 * the one they replace, so a warning is known by its hazard and when it
 * starts: a later file for the same pair re-issues it.
 *
 * Pure: no fetch, no database, so it is tested on its own (saws-cap.test.ts).
 */

export type FeedFile = { file: string; url: string; province: string; hazard: string; stamp: string };

export type CapArea = { desc: string; polygons: Array<Array<[number, number]>> };
export type CapInfo = {
  event: string; level: number | null; onset: string | null; effective: string | null; expires: string | null;
  description: string | null; instruction: string | null; areas: CapArea[];
};
export type CapAlert = { identifier: string; sent: string | null; msgType: string; infos: CapInfo[] };

/** What the database keeps of a file for eThekwini (ingest_saws_warning). */
export type EthekwiniWarning = {
  key: string; file: string; msg_type: string; touches: boolean;
  hazard?: string; level?: number; valid_from?: string; valid_until?: string; areas?: string;
  area_shapes?: Array<Array<[number, number]>>; impacts?: string | null; instructions?: string | null; issued_at?: string | null;
};

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/\r\n?/g, '\n')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

/** The text of the first <tag> inside xml, decoded and trimmed; null when absent or empty. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  const v = m ? decode(m[1]!).trim() : '';
  return v || null;
}
function tags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => m[1]!);
}

const FILE = /([A-Z]{2,3})_CAP_([A-Za-z]+)_(\d{8}_\d{6})\.xml$/;

/** The feed's files, oldest first; SAWS's own addresses, read over https. */
export function parseFeed(xml: string): FeedFile[] {
  const out = new Map<string, FeedFile>();
  for (const item of tags(xml, 'item')) {
    const link = tag(item, 'link') ?? tag(item, 'guid');
    const m = link ? FILE.exec(link) : null;
    if (!link || !m) continue;
    const file = `${m[1]}_CAP_${m[2]}_${m[3]}.xml`;
    out.set(file, { file, url: link.replace(/^http:\/\//i, 'https://'), province: m[1]!, hazard: m[2]!, stamp: m[3]! });
  }
  return [...out.values()].sort((a, b) => a.stamp.localeCompare(b.stamp));
}

/** The file's time as a Date (South African time in the name). */
export function stampTime(stamp: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return new Date(Number.NaN);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+02:00`);
}

/** "-30.13,30.62 -30.13,30.58 …" → [[lat, lng], …]; points outside the world dropped. */
function polygon(text: string): Array<[number, number]> {
  return text.trim().split(/\s+/).map((pair) => pair.split(',').map(Number) as [number, number])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
    .map(([lat, lng]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]);
}

export function parseCap(xml: string): CapAlert | null {
  if (!/<alert[\s>]/i.test(xml)) return null;
  const head = xml.split(/<info[\s>]/i)[0] ?? '';
  const infos = tags(xml, 'info').map((info): CapInfo => {
    const level = tags(info, 'parameter')
      .filter((p) => /alertType/i.test(tag(p, 'valueName') ?? ''))
      .map((p) => /Level\s*(\d{1,2})/i.exec(tag(p, 'value') ?? '')?.[1])
      .map(Number).find((n) => Number.isInteger(n) && n >= 1 && n <= 10) ?? null;
    return {
      event: tag(info, 'event') ?? '', level,
      onset: tag(info, 'onset'), effective: tag(info, 'effective'), expires: tag(info, 'expires'),
      description: tag(info, 'description'), instruction: tag(info, 'instruction'),
      areas: tags(info, 'area').map((a) => ({ desc: tag(a, 'areaDesc') ?? '', polygons: tags(a, 'polygon').map(polygon).filter((p) => p.length >= 3) })),
    };
  });
  return { identifier: tag(head, 'identifier') ?? '', sent: tag(head, 'sent'), msgType: tag(head, 'msgType') ?? 'Alert', infos };
}

/** SAWS names eThekwini "Ethekwini / King Shaka Airport" on land and "M_Ethekwini / M3 Durban" at sea. */
export const isEthekwini = (desc: string) => /^\s*(M_)?\s*e?thekwini\b/i.test(desc);

/** "M_Ethekwini / M3 Durban" → "At sea: Ethekwini / M3 Durban". */
const areaName = (desc: string) => desc.replace(/^\s*M_\s*/, 'At sea: ').trim();

/**
 * The file as eThekwini sees it: the highest level among the parts that name
 * eThekwini, that part's validity and words, eThekwini's areas and shapes,
 * and how many other KZN areas share the warning. touches is false when the
 * file does not name eThekwini at all.
 */
export function forEthekwini(alert: CapAlert, file: FeedFile, warningHazard: (event: string) => string): EthekwiniWarning {
  const hazardName = warningHazard(alert.infos[0]?.event || file.hazard.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const ours = alert.infos.filter((i) => i.areas.some((a) => isEthekwini(a.desc)) && i.level != null);
  const top = [...ours].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
  const start = top?.onset ?? top?.effective ?? alert.infos[0]?.onset ?? alert.infos[0]?.effective ?? alert.sent ?? file.stamp;
  const key = `${file.province}|${hazardName}|${start}`;
  const base = { key, file: file.file, msg_type: alert.msgType };
  if (!top || alert.msgType === 'Cancel') return { ...base, touches: Boolean(top) };

  // An area named in two parts is drawn once, from the higher level.
  const byDesc = new Map<string, CapArea>();
  for (const i of [...ours].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))) {
    for (const a of i.areas) if (isEthekwini(a.desc) && !byDesc.has(a.desc)) byDesc.set(a.desc, a);
  }
  const mine = [...byDesc.values()];
  const names = mine.map((a) => areaName(a.desc));
  const others = new Set(alert.infos.flatMap((i) => i.areas).filter((a) => !isEthekwini(a.desc)).map((a) => a.desc)).size;
  const from = top.onset ?? top.effective ?? alert.sent;
  return {
    ...base, touches: true, hazard: hazardName, level: top.level!,
    valid_from: from ?? undefined, valid_until: top.expires ?? undefined,
    areas: `${names.join('; ')}${others ? ` (and ${others} other KZN area${others === 1 ? '' : 's'})` : ''}`,
    area_shapes: mine.flatMap((a) => a.polygons),
    impacts: top.description, instructions: top.instruction, issued_at: alert.sent,
  };
}
