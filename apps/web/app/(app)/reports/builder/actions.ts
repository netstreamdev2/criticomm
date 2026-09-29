'use server';

import { revalidatePath } from 'next/cache';
import {
  type ChartSpec,
  type ReportDefinition,
  type ReportResult,
  type ReportVisibility,
  createReport,
  deleteReport,
  getDataset,
  canQueryDataset,
  logAudit,
  runReport,
  toCsv,
  updateReport,
} from '@criticom/api';
import type { UserRole } from '@criticom/db';
import { getSession, siloFilter } from '@/lib/session';

/**
 * Report builder actions.
 *
 * Server Actions post to whatever page the caller is already on, so the route
 * matrix never sees `/reports/builder` for these — every one re-checks the
 * caller itself. `runReport` additionally enforces dataset access and applies
 * department scoping from the session, so a hand-crafted spec cannot widen
 * what it can read.
 */

const READ_ONLY: UserRole[] = ['Viewer'];

/**
 * Running a report is reading, so every signed-in role may do it — including
 * Viewer, whose entire purpose is read access. Dataset-level permissions and
 * RLS still decide *what* they see.
 */
async function requireReportingAccess() {
  return getSession();
}

/**
 * Bulk export is a different act from reading a screen: it takes citizen PII
 * (caller names and numbers, addresses, patient names) out of the system to
 * somewhere with no access controls at all. A read-only stakeholder account
 * may study the data in place; it may not walk out with the file.
 */
async function requireExportAccess() {
  const session = await getSession();
  if (READ_ONLY.includes(session.role)) {
    throw new Error('Your role can view reports on screen but not export them.');
  }
  return session;
}

/** Saving writes a row, so the read-only role is excluded (RLS agrees). */
async function requireSaveAccess() {
  const session = await getSession();
  if (READ_ONLY.includes(session.role)) throw new Error('Your role cannot save reports.');
  return session;
}

/** Department scope for the caller: their own silo, or null for global roles. */
function scopeFor(silo: Parameters<typeof siloFilter>[0]) {
  return siloFilter(silo) ?? null;
}

export type RunOutcome =
  | { ok: true; result: ReportResult }
  | { ok: false; error: string };

export async function runReportAction(specJson: string): Promise<RunOutcome> {
  try {
    const { supabase, role, silo } = await requireReportingAccess();
    const spec = JSON.parse(specJson) as ReportDefinition;
    const result = await runReport(supabase, spec, { role, silo: scopeFor(silo) });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Report failed to run.' };
  }
}

/**
 * Build the CSV server-side and hand back the text. The client turns it into a
 * download. Keeps the whole thing inside the authenticated action rather than
 * putting a large spec into a URL.
 */
export async function exportCsvAction(
  specJson: string,
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  try {
    const { supabase, role, silo, fullName } = await requireExportAccess();
    const spec = JSON.parse(specJson) as ReportDefinition;
    const dataset = getDataset(spec.dataset);
    if (!dataset) return { ok: false, error: 'Unknown dataset.' };
    if (!canQueryDataset(dataset, role)) return { ok: false, error: 'Your role may not export this dataset.' };

    // Exports leave the system — a bulk extract of operational data is worth
    // a line in the audit trail even though the read itself is permitted.
    const result = await runReport(supabase, spec, { role, silo: scopeFor(silo) });
    await logAudit(supabase, {
      silo: silo,
      action_type: 'ReportExported',
      entity_type: 'report',
      entity_id: dataset.key,
      user_name: fullName,
      details: `Exported ${result.rows.length} ${dataset.label} rows to CSV`,
    }).catch(() => {});

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      csv: toCsv(result.columns, result.rows),
      filename: `hiktech-${dataset.key}-${stamp}.csv`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

export async function saveReportAction(formData: FormData) {
  const { supabase, silo, userId, fullName, role } = await requireSaveAccess();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Give the report a name.' };

  const specJson = String(formData.get('spec') ?? '');
  let spec: ReportDefinition;
  try {
    spec = JSON.parse(specJson) as ReportDefinition;
  } catch {
    return { error: 'The report definition could not be read.' };
  }

  const dataset = getDataset(spec.dataset);
  if (!dataset) return { error: 'Unknown dataset.' };
  if (!canQueryDataset(dataset, role)) return { error: 'Your role may not save reports on this dataset.' };

  const visibility = String(formData.get('visibility') ?? 'private') as ReportVisibility;
  if (!['private', 'department', 'global'].includes(visibility)) return { error: 'Unknown sharing option.' };

  let chart: ChartSpec = { type: 'none' };
  try {
    const raw = String(formData.get('chart') ?? '');
    if (raw) chart = JSON.parse(raw) as ChartSpec;
  } catch { /* a bad chart spec must not lose the report */ }

  const existingId = String(formData.get('id') ?? '').trim();
  try {
    if (existingId) {
      await updateReport(supabase, existingId, {
        name,
        description: String(formData.get('description') ?? ''),
        spec,
        chart,
        visibility,
      });
    } else {
      await createReport(supabase, {
        name,
        description: String(formData.get('description') ?? ''),
        silo,
        spec,
        chart,
        visibility,
        userId,
        userName: fullName,
      });
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save the report.' };
  }

  revalidatePath('/reports/builder');
  revalidatePath('/reports');
  return { ok: true };
}

export async function deleteReportAction(formData: FormData) {
  const { supabase } = await requireSaveAccess();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;
  // RLS restricts deletion to the author or an admin.
  await deleteReport(supabase, id).catch(() => {});
  revalidatePath('/reports/builder');
  revalidatePath('/reports');
}
