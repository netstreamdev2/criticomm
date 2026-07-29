import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Check Failed · Criticom' };

export default function ReasonPage() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-severity-critical">Readiness check not passed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            One or more of your readiness checks failed. You have <strong>not</strong> been placed on duty,
            and your supervisor has been notified via the audit log.
          </p>
          <p className="text-muted-foreground">
            Speak to your shift supervisor before retrying. If your situation changes, you can retake the
            check at any time.
          </p>
          <div className="flex gap-2">
            <Link href="/shift/mental-check" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold">
              Retake check
            </Link>
            <Link href="/dashboard" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
              Back to dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
