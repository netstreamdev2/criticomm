'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, Menu, X } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/why', label: 'Why' },
  { href: '/story', label: 'Storyboard' },
  { href: '/decisions', label: 'Decisions' },
  { href: '/platform', label: 'Platform' },
  { href: '/security', label: 'Security' },
  { href: '/manual', label: 'Manual' },
  { href: '/faq', label: 'FAQ' },
] as const;

const JOURNEY = [
  {
    number: '01',
    label: 'CONTROL ROOM',
    title: 'A call becomes one shared incident.',
    description: 'Log it once, route it to the right services, and give every decision the same starting point.',
    href: '/story',
    link: 'Follow a call',
  },
  {
    number: '02',
    label: 'IN THE FIELD',
    title: 'The response stays in view.',
    description: 'Crews receive assignments, record what happens on scene, and keep working when the signal drops.',
    href: '/platform',
    link: 'Explore the platform',
  },
  {
    number: '03',
    label: 'THE RECORD',
    title: 'The story is ready to review.',
    description: 'Times, actions, locations and evidence collect in one case file with a clear trail of who did what.',
    href: '/security',
    link: 'See how it is protected',
  },
] as const;

function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`hik-home-logo ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hiktech-brand.svg" alt="HIKTECH" />
    </span>
  );
}

function CommandVisual() {
  return (
    <div className="hik-home-visual" role="img" aria-label="Illustrative command screen showing an incident connected to responding teams">
      <div className="hik-home-visual-aura" />
      <div className="hik-home-dashboard hik-home-glass">
        <div className="hik-home-dashboard-top">
          <span className="hik-home-dashboard-kicker">ILLUSTRATIVE COMMAND VIEW</span>
          <span className="hik-home-live"><span /> COORDINATED</span>
        </div>
        <div className="hik-home-map">
          <div className="hik-home-map-grid" />
          <svg viewBox="0 0 520 360" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
            <path d="M-18 110C65 137 76 67 156 88S267 196 352 153 464 69 550 81" className="hik-home-road hik-home-road-wide" />
            <path d="M-16 292C86 251 113 331 213 272S356 219 543 256" className="hik-home-road" />
            <path d="M80-20C112 67 166 91 171 170S142 302 190 382" className="hik-home-road" />
            <path d="M373-18C334 60 383 133 332 206S344 323 397 381" className="hik-home-road" />
            <path d="M79 265 253 182 407 103" className="hik-home-route" />
            <path d="M253 182 380 277" className="hik-home-route hik-home-route-secondary" />
            <circle cx="79" cy="265" r="8" className="hik-home-unit-dot" />
            <circle cx="407" cy="103" r="8" className="hik-home-unit-dot" />
            <circle cx="380" cy="277" r="8" className="hik-home-unit-dot" />
            <circle cx="253" cy="182" r="29" className="hik-home-incident-halo" />
            <circle cx="253" cy="182" r="15" className="hik-home-incident-dot" />
            <circle cx="253" cy="182" r="4" fill="#fff" />
          </svg>
          <span className="hik-home-map-label hik-home-map-label-a">FIELD UNIT 01</span>
          <span className="hik-home-map-label hik-home-map-label-b">FIELD UNIT 02</span>
          <span className="hik-home-map-label hik-home-map-label-c">EMS UNIT 03</span>
        </div>
        <div className="hik-home-dashboard-bottom">
          <div>
            <span className="hik-home-small-label">SHARED INCIDENT</span>
            <strong>One live picture</strong>
          </div>
          <span className="hik-home-dashboard-signal"><span /> Synced across teams</span>
        </div>
      </div>

      <div className="hik-home-float hik-home-float-top hik-home-glass">
        <span className="hik-home-float-icon hik-home-float-icon-red">↗</span>
        <div><small>DISPATCH</small><strong>Teams notified</strong></div>
        <span className="hik-home-float-check"><Check size={14} strokeWidth={3} /></span>
      </div>
      <div className="hik-home-float hik-home-float-bottom hik-home-glass">
        <span className="hik-home-float-icon hik-home-float-icon-grey">◎</span>
        <div><small>FIELD UPDATE</small><strong>On-scene status recorded</strong></div>
        <span className="hik-home-float-check"><Check size={14} strokeWidth={3} /></span>
      </div>
      <div className="hik-home-count hik-home-glass"><strong>01</strong><span>incident<br />record</span></div>
    </div>
  );
}

export function LandingHome() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="hik-home" data-mode="dark">
      <div className="hik-home-shell">
        <header className="hik-home-header hik-home-glass">
          <Link href="/" aria-label="HIKTECH home" className="hik-home-logo-link"><Logo /></Link>
          <nav aria-label="Main navigation" className="hik-home-nav">
            {NAV_ITEMS.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          </nav>
          <div className="hik-home-header-actions">
            <Link href="/login" className="hik-home-sign-in">Sign in <ArrowUpRight size={16} /></Link>
            <button
              type="button"
              className="hik-home-menu-button"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menuOpen}
              aria-controls="hik-home-mobile-nav"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
          {menuOpen && (
            <nav id="hik-home-mobile-nav" aria-label="Mobile navigation" className="hik-home-mobile-nav hik-home-glass">
              {NAV_ITEMS.map((item) => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}<ArrowUpRight size={16} /></Link>)}
              <Link href="/login" className="hik-home-mobile-sign-in" onClick={() => setMenuOpen(false)}>Sign in to the console <ArrowUpRight size={16} /></Link>
            </nav>
          )}
        </header>

        <section className="hik-home-hero" aria-labelledby="hik-home-title">
          <div className="hik-home-hero-grid" />
          <div className="hik-home-hero-copy">
            <p className="hik-home-eyebrow"><span /> HIKTECH / EMERGENCY COMMAND</p>
            <h1 id="hik-home-title">Every emergency.<br /><em>One clear response.</em></h1>
            <p className="hik-home-intro">Dispatch, field response and the record that follows — connected in one live command picture for every service involved.</p>
            <div className="hik-home-hero-actions">
              <Link href="/platform" className="hik-home-primary-cta">Explore the platform <ArrowUpRight size={19} /></Link>
              <Link href="/story" className="hik-home-secondary-cta">Follow a call <ArrowRight size={18} /></Link>
            </div>
            <div className="hik-home-hero-proof">
              <div className="hik-home-proof-line" />
              <span>ONE INCIDENT</span><i /> <span>EVERY SERVICE</span><i /> <span>ONE RECORD</span>
            </div>
          </div>
          <CommandVisual />
          <div className="hik-home-hero-bottom">
            <span>BUILT FOR THE MOMENTS THAT MATTER</span>
            <div><span>CONTROL ROOM</span><span>FIELD RESPONSE</span><span>CASE FILE</span><span>COMMAND</span></div>
          </div>
        </section>

        <section className="hik-home-journey" aria-labelledby="hik-home-journey-title">
          <div className="hik-home-section-heading">
            <p className="hik-home-eyebrow"><span /> THE FULL RESPONSE</p>
            <h2 id="hik-home-journey-title">From first ring<br />to final record.</h2>
            <p>Every handoff matters. HikTech keeps the work connected from the call taker to the team on scene and the people who review the case later.</p>
          </div>
          <div className="hik-home-journey-grid">
            {JOURNEY.map((item) => (
              <Link href={item.href} key={item.number} className="hik-home-journey-card hik-home-glass">
                <span className="hik-home-journey-number">{item.number}</span>
                <span className="hik-home-journey-label">{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <span className="hik-home-journey-link">{item.link} <ArrowUpRight size={17} /></span>
              </Link>
            ))}
          </div>
        </section>

        <section className="hik-home-close hik-home-glass">
          <div><p className="hik-home-eyebrow"><span /> A BETTER SHARED PICTURE</p><h2>One platform.<br /><em>Every team in sync.</em></h2></div>
          <div><p>See how a single incident can bring the control room, field crews and command together without losing the detail that matters.</p><Link href="/why" className="hik-home-primary-cta">Why HikTech exists <ArrowUpRight size={19} /></Link></div>
        </section>

        <footer className="hik-home-footer">
          <Logo className="hik-home-footer-logo" />
          <p>Emergency command for the whole response.</p>
          <div>{NAV_ITEMS.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}</div>
          <span>© 2026 Netstream Integrated Solutions</span>
        </footer>
      </div>
    </main>
  );
}
