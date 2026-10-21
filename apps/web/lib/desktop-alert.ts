/**
 * The computer's own notifications (bottom corner of the screen), for when
 * the console is open but not in front: another window, another tab, or the
 * browser minimised. Only once the person has allowed them; never asked for
 * without a click.
 */

const supported = () => typeof window !== 'undefined' && 'Notification' in window;

/** 'granted', 'denied', 'default' (not asked yet), or 'unsupported'. */
export function desktopAlertsState(): NotificationPermission | 'unsupported' {
  return supported() ? Notification.permission : 'unsupported';
}

/** Ask once, from a click. */
export async function allowDesktopAlerts(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** The console is not what the person is looking at. */
export const consoleOutOfSight = () =>
  typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !document.hasFocus());

/** Show one; a click brings the console to the front and opens `href`. */
export function desktopAlert(opts: { tag: string; title: string; body?: string | null; href?: string | null; urgent?: boolean }) {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body ?? undefined,
      tag: opts.tag,
      icon: '/hiktech-brand.svg',
      requireInteraction: Boolean(opts.urgent),
    });
    n.onclick = () => {
      window.focus();
      if (opts.href) window.location.assign(opts.href);
      n.close();
    };
  } catch { /* some browsers allow them only from a service worker */ }
}
