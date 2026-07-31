'use client';

/**
 * Last-resort boundary. A crash in the root layout unmounts everything —
 * without this the operator gets a blank white page with no way forward,
 * which in a dispatch room is indistinguishable from the system being down.
 *
 * This file replaces <html>/<body> entirely, so it cannot rely on the app's
 * stylesheet or fonts. Styles are inline on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#050510',
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <p
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#ef4444',
              margin: 0,
            }}
          >
            CRITICOMM
          </p>
          <h1 style={{ margin: '0.75rem 0 0', fontSize: '1.5rem', lineHeight: 1.3 }}>
            The console hit an unexpected error
          </h1>
          <p style={{ margin: '0.75rem 0 0', color: '#9ca3af', lineHeight: 1.6, fontSize: '0.9rem' }}>
            Your session and all logged incidents are safe — nothing was lost. Reload to continue.
            If this keeps happening, fall back to radio and tell your system administrator.
          </p>

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: '2.75rem',
                padding: '0 1.5rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: '#dc3545',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Reload the console
            </button>
            <a
              href="/dashboard"
              style={{
                height: '2.75rem',
                padding: '0 1.5rem',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '0.5rem',
                border: '1px solid #1f1f3a',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.875rem',
                textDecoration: 'none',
              }}
            >
              Back to dashboard
            </a>
          </div>

          {/* The digest is what an administrator needs to find this in the logs. */}
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.7rem', color: '#6b7280', fontFamily: 'monospace' }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
