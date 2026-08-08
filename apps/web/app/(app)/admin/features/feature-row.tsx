'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { FeatureDef } from '@criticom/api';
import { toggleFeatureAction } from './actions';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';

export function FeatureRow({ def, enabled }: { def: FeatureDef; enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const toggle = () => {
    const fd = new FormData();
    fd.set('key', def.key);
    fd.set('enabled', String(!enabled));
    start(async () => {
      const res = await toggleFeatureAction(fd);
      if (res?.error) {
        toast.push({ title: res.error, tone: 'critical', duration: 6000 });
        return;
      }
      toast.push({
        title: `${def.label} ${enabled ? 'disabled' : 'enabled'}`,
        body: enabled ? def.description : undefined,
        tone: enabled ? 'warning' : 'success',
        duration: 5000,
      });
      router.refresh();
    });
  };

  return (
    <li className="flex items-start gap-4 p-4">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${def.label}: ${enabled ? 'enabled' : 'disabled'}`}
        onClick={toggle}
        disabled={pending}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          enabled ? 'bg-success' : 'bg-muted',
        )}
      >
        {pending ? (
          <Loader2 className="absolute inset-0 m-auto size-3.5 animate-spin text-white" />
        ) : (
          <span
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
              enabled ? 'left-[22px]' : 'left-0.5',
            )}
          />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-semibold">{def.label}</h3>
          <code className="text-xs text-muted-foreground">{def.key}</code>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{def.description}</p>
      </div>
    </li>
  );
}
