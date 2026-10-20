import Link from 'next/link';
import { HardHat, Headset, Radio } from 'lucide-react';
import {
  DEPARTMENT_LABELS, getTalkServerStatus, kindLabel, listApparatus, listPersonnel, listRadioRegister,
} from '@criticom/api';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { loadRadioDesk } from '@/lib/radio';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { RadioForm, type RadioDraft } from './radio-form';
import { VoiceServerForm } from './voice-server-form';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Radios · Admin · HikTech' };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * The radio register: which person or vehicle each push-to-talk radio and
 * hard hat belongs to. Accounts a platform reports that are not in the
 * register are listed first, ready to add.
 */
export default async function AdminRadiosPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const [register, people, vehicles, desk, talk] = await Promise.all([
    listRadioRegister(supabase, { includeRetired: true }).catch(() => []),
    listPersonnel(supabase, siloFilter(silo)).catch(() => []),
    listApparatus(supabase, siloFilter(silo)).catch(() => []),
    loadRadioDesk(supabase),
    getTalkServerStatus(supabase),
  ]);
  const setsVoiceServer = role === 'SystemAdmin' || role === 'SuperAdmin';
  const editing = register.find((r) => r.id === one(params.edit)) as (typeof register)[number] & {
    imei?: string | null; notes?: string | null; provider_user_id?: string | null;
  } | undefined;
  const draft: RadioDraft = editing
    ? {
      id: editing.id, provider: editing.provider, kind: editing.kind, account: editing.account, label: editing.label ?? '',
      providerUserId: editing.provider_user_id ?? '', imei: editing.imei ?? '', silo: editing.silo,
      personnelId: editing.personnel_id ?? '', apparatusId: editing.apparatus_id ?? '', notes: editing.notes ?? '', active: editing.active,
    }
    : {
      id: '', provider: one(params.provider) === 'hiktech' ? 'hiktech' : 'pocstar',
      kind: one(params.kind) === 'hard_hat' ? 'hard_hat' : one(params.kind) === 'dispatcher' ? 'dispatcher' : 'radio',
      account: one(params.account), label: one(params.label), providerUserId: '', imei: '',
      silo: role === 'Admin' ? silo : '', personnelId: '', apparatusId: '', notes: '', active: true,
    };
  const unregistered = desk.views.filter((v) => !v.register);
  const departments = role === 'Admin' ? [silo] : Object.keys(DEPARTMENT_LABELS);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-sky-500 text-white shadow-lg">
            <Radio className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{t('Radios')}</h1>
            <p className="text-sm text-muted-foreground">{t('Whose radio, whose hard hat.')}</p>
          </div>
        </div>
        <Link href="/dispatch/ptt" className="frost-pill rounded-full border border-border px-3 py-1.5 text-xs font-semibold">{t('Radio Desk')}</Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          {unregistered.length ? (
            <section className="frost rounded-xl border border-amber-500/40 p-4">
              <h2 className="text-sm font-bold">{t('Not on the list yet: {length}', { length: unregistered.length })}</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {unregistered.map((v) => (
                  <li key={v.key}>
                    <Link
                      href={`/admin/radios?provider=${v.provider}&account=${encodeURIComponent(v.account)}&kind=${v.kind}${v.live?.name ? `&label=${encodeURIComponent(v.live.name)}` : ''}`}
                      className="frost-pill inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold"
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v.live?.online ? '#22c55e' : '#64748b' }} />
                      {v.live?.name && v.live.name !== v.account ? <span>{v.live.name}</span> : null}
                      <span className="font-mono text-muted-foreground">{v.account}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="frost overflow-hidden rounded-xl border border-border">
            <p className="border-b border-border px-4 py-3 text-sm font-semibold">{t('{length} in the register', { length: register.length })}</p>
            <SimpleTable headers={['Radio', 'Kind', 'Belongs to', 'Department', 'Status', 'Changed', '']} empty={t('No radios in the register yet.')}>
              {register.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono font-semibold">{r.account}{r.label ? <span className="block font-sans text-xs font-normal text-muted-foreground">{r.label}</span> : null}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      {r.kind === 'hard_hat' ? <HardHat className="h-3.5 w-3.5" /> : r.kind === 'dispatcher' ? <Headset className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
                      {kindLabel(r.kind)}
                    </span>
                  </Td>
                  <Td>{r.personName ?? r.unitNumber ?? <span className="text-muted-foreground">{t('Nobody yet')}</span>}</Td>
                  <Td>{DEPARTMENT_LABELS[r.silo] ?? r.silo}</Td>
                  <Td>{r.active ? <span className="text-emerald-500">{t('In service')}</span> : <span className="text-muted-foreground">{t('Retired')}</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatSaTime((r as { updated_at?: string }).updated_at)}</Td>
                  <Td><Link href={`/admin/radios?edit=${r.id}`} className="font-semibold text-accent hover:underline">{t('Edit')}</Link></Td>
                </Tr>
              ))}
            </SimpleTable>
          </section>
        </div>

        <div className="space-y-4">
        {setsVoiceServer && talk ? <VoiceServerForm status={talk} /> : null}
        <RadioForm
          key={draft.id || `${draft.provider}:${draft.account}`}
          draft={draft}
          departments={departments.map((d) => ({ id: d, label: DEPARTMENT_LABELS[d] ?? d }))}
          people={people.map((p) => ({ id: p.id, label: `${[p.rank, p.first_name, p.last_name].filter(Boolean).join(' ')} (${p.badge_number})` }))}
          vehicles={vehicles.map((v) => ({ id: v.id, label: `${v.unit_number}${v.name ? ` · ${v.name}` : ''}` }))}
        />
        </div>
      </div>
    </div>
  );
}
