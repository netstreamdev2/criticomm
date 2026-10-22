import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { saDay, saTime } from '@criticom/api';
import { tNow } from './translator';

/**
 * The full incident as a PDF, made on the phone: the call, its timeline, the
 * filed police report with each of its forms, and the evidence (photos shown,
 * voice notes and files listed). Saved or shared from the phone's own menu.
 * Only what this person may already read goes in; nothing is fetched here.
 */

export type CasePdfInput = {
  incident: {
    incident_number: string; incident_type: string; incident_severity: string; status: string;
    location_address: string | null; call_timestamp: string | null; incident_created_at: string;
    caller_name: string | null; caller_number: string | null; call_description: string | null;
  };
  updates: Array<{ timestamp: string; created_by_name: string | null; message: string }>;
  report: null | {
    title: string;
    filedBy: string;
    caseNumber: string | null;
    sections: Array<{ title: string; items: Array<{ label: string; value: string }> }>;
    narrative: string | null;
  };
  evidence: Array<{ kind: string; by: string | null; at: string; caption: string | null; url: string | null }>;
};

const esc = (s: string | null | undefined) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stamp = (iso: string | null | undefined) => (iso ? `${saDay(iso)} ${saTime(iso)}` : '—');

export function buildCaseHtml(c: CasePdfInput): string {
  const i = c.incident;
  const row = (label: string, value: string | null | undefined) =>
    value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '';
  const photos = c.evidence.filter((e) => e.kind === 'image' && e.url);
  const others = c.evidence.filter((e) => !(e.kind === 'image' && e.url));
  const timeline = [...c.updates].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #111; font-size: 11px; margin: 28px; }
    h1 { font-size: 20px; margin: 0; } h2 { font-size: 13px; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #111; text-transform: uppercase; letter-spacing: .06em; }
    h3 { font-size: 11px; margin: 12px 0 4px; text-transform: uppercase; color: #444; }
    .sub { color: #555; margin-top: 2px; } .sev { display: inline-block; padding: 1px 8px; border-radius: 9px; border: 1px solid #111; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 1px solid #ddd; }
    th { width: 32%; color: #444; font-weight: 600; } .tl td:first-child { width: 22%; white-space: nowrap; color: #444; }
    .narr { white-space: pre-wrap; border: 1px solid #ddd; padding: 8px; border-radius: 4px; }
    .photos { display: flex; flex-wrap: wrap; gap: 8px; } .photos figure { margin: 0; width: 48%; } .photos img { width: 100%; border: 1px solid #ccc; }
    figcaption { color: #555; font-size: 10px; } .foot { margin-top: 24px; color: #777; font-size: 9px; }
  </style></head><body>
    <h1>${esc(i.incident_number)}</h1>
    <div class="sub">${esc(i.incident_type)} · <span class="sev">${esc(i.incident_severity)}</span> · ${esc(i.status)}</div>

    <h2>${esc(tNow('The call'))}</h2>
    <table>
      ${row(tNow('Logged'), stamp(i.call_timestamp ?? i.incident_created_at))}
      ${row(tNow('Location'), i.location_address)}
      ${row(tNow('Caller'), [i.caller_name, i.caller_number].filter(Boolean).join(' · '))}
      ${row(tNow('Description'), i.call_description)}
    </table>

    ${c.report ? `
      <h2>${esc(c.report.title)}</h2>
      <div class="sub">${esc(c.report.filedBy)}${c.report.caseNumber ? ` · ${esc(tNow('Case number'))} ${esc(c.report.caseNumber)}` : ''}</div>
      ${c.report.sections.map((s) => `<h3>${esc(s.title)}</h3><table>${s.items.map((it) => row(it.label, it.value)).join('')}</table>`).join('')}
      ${c.report.narrative ? `<h3>${esc(tNow('Officer narrative'))}</h3><div class="narr">${esc(c.report.narrative)}</div>` : ''}
    ` : ''}

    <h2>${esc(tNow('Evidence'))} (${c.evidence.length})</h2>
    ${photos.length ? `<div class="photos">${photos.map((p) => `<figure><img src="${esc(p.url)}" /><figcaption>${esc(p.caption ?? '')} ${esc(p.by ?? '')} · ${esc(stamp(p.at))}</figcaption></figure>`).join('')}</div>` : ''}
    ${others.length ? `<table>${others.map((o) => `<tr><th>${esc(o.kind)}</th><td>${esc(o.caption ?? '')} ${esc(o.by ?? '')} · ${esc(stamp(o.at))}</td></tr>`).join('')}</table>` : ''}
    ${c.evidence.length === 0 ? `<div class="sub">${esc(tNow('No evidence on record.'))}</div>` : ''}

    <h2>${esc(tNow('Timeline'))} (${timeline.length})</h2>
    <table class="tl">${timeline.map((u) => `<tr><td>${esc(stamp(u.timestamp))}</td><td>${esc(u.created_by_name ? `${u.created_by_name}: ` : '')}${esc(u.message)}</td></tr>`).join('')}</table>

    <div class="foot">${esc(tNow('Made on the phone'))} ${esc(stamp(new Date().toISOString()))}</div>
  </body></html>`;
}

/** Make the PDF and open the phone's menu to save, open or send it. */
export async function shareCasePdf(input: CasePdfInput): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: buildCaseHtml(input) });
  const target = `${FileSystem.cacheDirectory}${input.incident.incident_number.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: target });
  if (!(await Sharing.isAvailableAsync())) throw new Error(tNow('Sharing is not available on this phone.'));
  await Sharing.shareAsync(target, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: input.incident.incident_number });
}
