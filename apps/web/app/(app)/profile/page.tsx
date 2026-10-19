import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FormSection, TextField, TextAreaField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { ThemeGrid } from '@/components/theme-picker';
import { updateProfileAction, generateCallSignAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · HikTech' };

export default async function ProfilePage() {
  const { t } = await requestT();
  const { supabase, userId, silo, role, fullName } = await getSession();
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', userId).maybeSingle();

  const [first = '', last = ''] = (profile?.full_name ?? fullName).split(' ');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Profile & settings')}</h1>
          <p className="text-muted-foreground">
            {role} · {silo}{profile?.last_login ? ` · last login ${formatSaTime(profile.last_login)}` : ''}
          </p>
        </div>
        <Link href="/profile/my-hr" className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
          {t('My HR portal →')}</Link>
      </header>

      <form action={updateProfileAction} className="space-y-4">
        <FormSection title={t('Personal details')}>
          <TextField name="full_name" label={t('Full name')} defaultValue={profile?.full_name ?? fullName} required className="sm:col-span-2" />
          <TextField name="badge_number" label={t('Badge number')} defaultValue={profile?.badge_number} />
          <TextField name="rank" label={t('Rank')} defaultValue={profile?.rank} />
          <TextField name="station" label={t('Station')} defaultValue={profile?.station} />
          <TextField name="platoon" label={t('Platoon')} defaultValue={profile?.platoon} />
          <TextField name="contact_number" label={t('Contact number')} defaultValue={profile?.contact_number} />
          <TextField name="emergency_contact" label={t('Emergency contact')} defaultValue={profile?.emergency_contact} />
          <TextAreaField name="notes" label={t('Notes')} defaultValue={profile?.notes} className="sm:col-span-2 lg:col-span-3" />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">{t('Save profile')}</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t('Call sign')}</CardTitle>
          <CardDescription>{t('NATO phonetic call-sign generator.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="font-mono text-xl">{profile?.call_sign ?? 'Not assigned'}</p>
          <form action={generateCallSignAction}>
            <input type="hidden" name="first_name" value={first} />
            <input type="hidden" name="last_name" value={last} />
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold">
              {profile?.call_sign ? 'Regenerate' : 'Generate'}
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Appearance')}</CardTitle>
          <CardDescription>
            {t('Pick the look that suits your control room. Saved to this browser and applied instantly.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeGrid />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Account')}</CardTitle>
          <CardDescription>
            {t('Password resets go through Supabase Auth — use “Forgot password” on the login page.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div><p className="text-xs uppercase text-muted-foreground">{t('Role')}</p><p>{role}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('Silo')}</p><p>{silo}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('Total incidents handled')}</p><p>{profile?.total_incidents ?? 0}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('On duty')}</p><p>{profile?.is_on_duty ? 'Yes' : 'No'}</p></div>
        </CardContent>
      </Card>
    </div>
  );
}
