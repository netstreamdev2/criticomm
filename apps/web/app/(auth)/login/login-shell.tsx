'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check, LockKeyhole } from 'lucide-react';

export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <main className="hik-home hik-login" data-mode="dark">
      <div className="hik-home-shell hik-login-shell">
        <header className="hik-login-header hik-home-glass">
          <Link href="/" aria-label="HIKTECH home" className="hik-home-logo-link">
            <span className="hik-home-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hiktech-brand.svg" alt="HIKTECH" />
            </span>
          </Link>
          <div className="hik-login-header-actions">
            <Link href="/" className="hik-login-back"><ArrowLeft size={16} /><span>Back to site</span></Link>
          </div>
        </header>

        <div className="hik-login-grid">
          <section className="hik-login-story" aria-labelledby="hik-login-story-title">
            <div className="hik-login-story-grid" aria-hidden="true" />
            <div className="hik-login-story-copy">
              <p className="hik-home-eyebrow"><span /> HIKTECH / EMERGENCY COMMAND</p>
              <h1 id="hik-login-story-title">The whole response.<br /><em>One shared picture.</em></h1>
              <p>Bring the control room, field teams and command together around the same incident, from first call to final record.</p>
            </div>
            <div className="hik-login-visual hik-home-glass" aria-label="The stages of a connected emergency response">
              <div className="hik-login-visual-head"><span>CONNECTED RESPONSE</span><span><i /> ONE INCIDENT</span></div>
              <div className="hik-login-visual-steps">
                <div><span className="hik-login-step-number">01</span><span><small>CONTROL ROOM</small><strong>Call captured</strong></span><span className="hik-login-step-check"><Check size={14} strokeWidth={3} /></span></div>
                <div><span className="hik-login-step-number">02</span><span><small>FIELD TEAMS</small><strong>Response coordinated</strong></span><span className="hik-login-step-check"><Check size={14} strokeWidth={3} /></span></div>
                <div><span className="hik-login-step-number">03</span><span><small>CASE FILE</small><strong>Record ready to review</strong></span><span className="hik-login-step-check"><Check size={14} strokeWidth={3} /></span></div>
              </div>
            </div>
            <p className="hik-login-story-foot">ONE INCIDENT <span /> EVERY SERVICE <span /> ONE RECORD</p>
          </section>

          <section className="hik-login-access" aria-labelledby="hik-login-title">
            <div className="hik-login-card hik-home-glass">
              <div className="hik-login-lock"><LockKeyhole size={21} strokeWidth={1.8} /></div>
              <p className="hik-login-kicker">SECURE CONSOLE ACCESS</p>
              <h2 id="hik-login-title">Welcome back.</h2>
              <p className="hik-login-instruction">Sign in with your email address or badge number, and your password.</p>
              {children}
              <div className="hik-login-card-foot"><span /> Authorised personnel only. All access is audited.</div>
            </div>
            <p className="hik-login-help">New to HikTech? <Link href="/platform">Explore the platform <ArrowUpRight size={15} /></Link></p>
          </section>
        </div>
      </div>
    </main>
  );
}
