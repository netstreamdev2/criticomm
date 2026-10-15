import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from 'expo-router';
import { listFineOffences, listFines, paidByFine, type Fine } from '@criticom/api';
import { fineFigures, type FineFigures, type FineOffence, payByDate, discountFor } from '@criticom/db/fines';
import type { SlipData } from '@criticom/db/fine-slip';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import type { OutboxEntry, OutboxOp } from '@/lib/outbox';
import { useT } from '@/lib/i18n';

/**
 * Fines on the phone (migration 0057).
 *
 *   • The charge book is cached, so a notice can be written in a dead zone
 *     with the right offences and amounts.
 *   • A notice is queued through the outbox and the slip can be printed at
 *     once — provisional, with the phone's reference — even with no signal.
 *   • An officer sees the fines they issued; the register is the console's.
 */

const OFFENCES_KEY = 'criticom.fine_offences.v1';
/** The issuing authority printed on a provisional slip until the server's is known. */
export const DEFAULT_AUTHORITY = 'eThekwini Metro Police';

export type IssueFineOp = Extract<OutboxOp, { kind: 'issue_fine' }>;

/** The charge book: cached copy first, then the server's. */
export function useFineOffences() {
  const { session } = useAuth();
  const [offences, setOffences] = useState<FineOffence[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const rows = await listFineOffences(getSupabase(), { activeOnly: true });
      setOffences(rows);
      await AsyncStorage.setItem(OFFENCES_KEY, JSON.stringify(rows)).catch(() => {});
    } catch {
      /* offline: keep the cached copy */
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(OFFENCES_KEY)
      .then((raw) => {
        if (!live || !raw) return;
        const cached = JSON.parse(raw) as unknown;
        if (Array.isArray(cached)) setOffences(cached as FineOffence[]);
      })
      .catch(() => {})
      .finally(() => { void refresh(); });
    return () => { live = false; };
  }, [refresh]);

  return { offences, loading, refresh };
}

/** One notice: the charges served together, newest notice first. */
export type NoticeGroup = { key: string; fines: Fine[]; first: Fine; total: number };

export function groupNotices(fines: Fine[]): NoticeGroup[] {
  const map = new Map<string, Fine[]>();
  for (const f of fines) {
    const key = f.group_ref ?? f.id;
    map.set(key, [...(map.get(key) ?? []), f]);
  }
  return [...map.entries()]
    .map(([key, rows]) => {
      const sorted = rows.sort((a, b) => a.charge_seq - b.charge_seq);
      return { key, fines: sorted, first: sorted[0]!, total: sorted.reduce((s, r) => s + Number(r.amount), 0) };
    })
    .sort((a, b) => b.first.issued_at.localeCompare(a.first.issued_at));
}

/** The fines this officer issued, the money paid against them, and the figures. */
export function useMyFines() {
  const { t } = useT();
  const { session } = useAuth();
  const { pending, failed } = useSync();
  const [fines, setFines] = useState<Fine[]>([]);
  const [paid, setPaid] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const sb = getSupabase();
      const rows = await listFines(sb, { issuedBy: session.user.id, limit: 500 });
      setFines(rows);
      setPaid(await paidByFine(sb, rows.map((r) => r.id)).catch(() => new Map()));
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? t('Could not load your fines.'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // When a queued notice is delivered it leaves the outbox: load it.
  const queuedKey = [...pending, ...failed].filter((e) => e.op.kind === 'issue_fine').map((e) => e.id).join(',');
  useEffect(() => { void refresh(); }, [queuedKey, refresh]);

  const figures: FineFigures = useMemo(() => fineFigures(fines, paid), [fines, paid]);
  const queued = useMemo(
    () => [...pending, ...failed].filter((e): e is OutboxEntry & { op: IssueFineOp } => e.op.kind === 'issue_fine'),
    [pending, failed],
  );

  return { fines, notices: useMemo(() => groupNotices(fines), [fines]), paid, figures, queued, loading, error, refresh };
}

/** "P-1A2B3C4D": the reference on a slip printed before the phone delivered it. */
export function provisionalRef(entryId: string): string {
  return `P-${entryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** The slip for a notice still in the outbox. */
export function slipFromQueued(entry: OutboxEntry & { op: IssueFineOp }, officerName: string): SlipData {
  const n = entry.op.notice as Record<string, string | number | boolean | null | undefined>;
  const s = (k: string) => (n[k] === undefined || n[k] === null || n[k] === '' ? null : String(n[k]));
  const ref = provisionalRef(entry.id);
  const type = entry.op.noticeType;
  return {
    noticeType: type,
    provisional: true,
    issuingAuthority: DEFAULT_AUTHORITY,
    issuedAt: entry.occurredAt,
    offenceAt: entry.occurredAt,
    officerName,
    officerNo: s('officer_infrastructure_no'),
    infringer: {
      name: [s('offender_first_names'), s('offender_surname')].filter(Boolean).join(' ')
        || (type === 'Section 341' ? `Owner of ${s('vehicle_reg') ?? 'the vehicle'}` : '—'),
      idType: s('offender_id_type'), idNumber: s('offender_id_number'), dob: s('offender_dob'),
      gender: s('offender_gender'), licenceCode: s('offender_licence_code'), prdp: s('offender_prdp_code'),
      phone: s('offender_phone'), address: s('offender_address'),
    },
    vehicle: {
      reg: s('vehicle_reg')?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? null, disc: s('vehicle_licence_disc'),
      type: s('vehicle_type'), makeModel: [s('vehicle_make'), s('vehicle_model')].filter(Boolean).join(' ') || null,
      colour: s('vehicle_colour'),
    },
    place: {
      street: [s('street_a'), s('street_b')].filter(Boolean).join(' / ') || null, suburb: s('suburb'),
      city: s('city') ?? 'Durban', province: s('province') ?? 'KwaZulu-Natal', direction: s('direction'),
      lat: n.latitude ? Number(n.latitude) : null, lng: n.longitude ? Number(n.longitude) : null,
      description: s('location'),
    },
    charges: entry.op.charges.map((c, i) => ({
      ref: entry.op.charges.length > 1 ? `${ref}/${i + 1}` : ref,
      noticeNumber: i === 0 ? s('notice_number') : null,
      code: c.code ?? null, legalRef: c.legal_ref ?? null, description: c.description,
      amount: Number(c.amount ?? 0), discount: discountFor(type, Number(c.amount ?? 0)), demerit: c.demerit ?? 0,
    })),
    courtName: s('court_name'),
    courtDate: s('court_date'),
    payBy: payByDate(type, entry.occurredAt, s('court_date')),
    magisterialDistrict: s('magisterial_district'),
    officerSignature: s('officer_signature'),
    infringerSignature: s('infringer_signature'),
    infringerRefused: Boolean(n.infringer_refused) && !s('infringer_signature'),
  };
}

/* ── Paper ──────────────────────────────────────────────────────────── */

export async function printSlip(html: string) {
  await Print.printAsync({ html });
}

export async function shareSlipPdf(html: string, name: string) {
  const { uri } = await Print.printToFileAsync({ html });
  const target = `${FileSystem.cacheDirectory}${name.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: target });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(target, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Fine slip (PDF)' });
}

/** Tone for a fine's status, matching the console's. */
export function statusTone(status: Fine['status'], palette: { low: string; medium: string; critical: string; muted: string; accent: string }) {
  switch (status) {
    case 'Paid': return palette.low;
    case 'Partially Paid': return palette.accent;
    case 'Disputed': return palette.critical;
    case 'Cancelled': return palette.muted;
    default: return palette.medium;
  }
}
