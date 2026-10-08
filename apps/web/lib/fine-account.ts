import 'server-only';
import { listFineTransactions, listFines, type ChargeTransaction, type Fine } from '@criticom/api';
import type { getSession } from '@/lib/session';
import type { AccountKey } from '@/lib/fines';

type Client = Awaited<ReturnType<typeof getSession>>['supabase'];

/**
 * Everything on the register for one ID number and/or one registration: the
 * fines (once each, newest first), the money paid against each, and every
 * ledger entry. RLS decides what is visible; the page is for command staff.
 */
export async function loadFineAccount(supabase: Client, key: AccountKey) {
  const [byId, byReg] = await Promise.all([
    key.id ? listFines(supabase, { idNumber: key.id, limit: 1000 }) : Promise.resolve([] as Fine[]),
    key.reg ? listFines(supabase, { vehicleReg: key.reg, limit: 1000 }) : Promise.resolve([] as Fine[]),
  ]);
  const map = new Map<string, Fine>();
  for (const f of [...byId, ...byReg]) map.set(f.id, f);
  const fines = [...map.values()].sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  const ledger: ChargeTransaction[] = await listFineTransactions(supabase, fines.map((f) => f.id)).catch(() => []);
  const paid = new Map<string, number>();
  for (const t of ledger) {
    if (!t.fine_id) continue;
    const sign = t.tx_type === 'Refund' ? -1 : t.tx_type === 'Payment' || t.tx_type === 'Adjustment' ? 1 : 0;
    paid.set(t.fine_id, (paid.get(t.fine_id) ?? 0) + sign * Number(t.amount));
  }
  // The name on the newest fine for this ID; a registration may have many drivers.
  const person = key.id ? fines.find((f) => f.offender_id_number === key.id) : undefined;
  return { fines, ledger, paid, person };
}
