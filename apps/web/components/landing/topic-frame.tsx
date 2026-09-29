'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react';

const NAV = [
  { href: '/why', label: 'Why', slug: 'why' },
  { href: '/story', label: 'Storyboard', slug: 'story' },
  { href: '/decisions', label: 'Decisions', slug: 'decisions' },
  { href: '/platform', label: 'Platform', slug: 'platform' },
  { href: '/security', label: 'Security', slug: 'security' },
  { href: '/manual', label: 'Manual', slug: 'manual' },
  { href: '/faq', label: 'FAQ', slug: 'faq' },
] as const;

const SECTIONS: Record<string, { href: string; label: string }[]> = {
  why: [{ href: '#why', label: 'The problem' }, { href: '#vision', label: 'The vision' }, { href: '#outcomes', label: 'The outcome' }],
  story: [{ href: '#flow', label: 'The call' }, { href: '#story', label: 'The storyboard' }, { href: '#shift', label: 'The shift' }],
  decisions: [{ href: '#decisions', label: 'Design choices' }, { href: '#go-live', label: 'Going live' }],
  platform: [{ href: '#console', label: 'The console' }, { href: '#services', label: 'The services' }, { href: '#platform', label: 'The modules' }, { href: '#integrations', label: 'Integrations' }],
  security: [{ href: '#security', label: 'Access and evidence' }],
  manual: [{ href: '#manual', label: 'Operations manual' }],
  faq: [{ href: '#faq', label: 'Common questions' }],
};

type Topic = { slug: string; label: string; title: string; description: string };
function Logo({ footer = false }: { footer?: boolean }) {
  return (
    <span className={`hik-home-logo${footer ? ' hik-home-footer-logo' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hiktech-brand.svg" alt="HIKTECH" />
    </span>
  );
}

export function TopicFrame({ topic, children }: { topic: Topic | null; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const items = topic ? SECTIONS[topic.slug] ?? [] : [];
  const index = topic ? NAV.findIndex((entry) => entry.slug === topic.slug) + 1 : 0;

  return (
    <main className="hik-home hk-topic" data-mode="dark">
      <div className="hik-home-shell">
        <header className="hik-home-header hik-home-glass">
          <Link href="/" aria-label="HIKTECH home" className="hik-home-logo-link"><Logo /></Link>
          <nav aria-label="Main navigation" className="hik-home-nav">
            {NAV.map((item) => <Link key={item.href} href={item.href} aria-current={topic?.slug === item.slug ? 'page' : undefined}>{item.label}</Link>)}
          </nav>
          <div className="hik-home-header-actions">
            <Link href="/login" className="hik-home-sign-in">Sign in <ArrowUpRight size={16} /></Link>
            <button type="button" className="hik-home-menu-button" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} aria-controls="hk-topic-mobile-nav" onClick={() => setMenuOpen((open) => !open)}>
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
          {menuOpen && (
            <nav id="hk-topic-mobile-nav" aria-label="Mobile navigation" className="hik-home-mobile-nav hik-home-glass">
              <Link href="/" onClick={() => setMenuOpen(false)}>Home <ArrowUpRight size={16} /></Link>
              {NAV.map((item) => <Link key={item.href} href={item.href} aria-current={topic?.slug === item.slug ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{item.label}<ArrowUpRight size={16} /></Link>)}
              <Link href="/login" className="hik-home-mobile-sign-in" onClick={() => setMenuOpen(false)}>Sign in to the console <ArrowUpRight size={16} /></Link>
            </nav>
          )}
        </header>

        {topic && (
          <section className="hk-topic-hero" aria-labelledby="hk-topic-title">
            <div className="hk-topic-hero-grid" aria-hidden="true" />
            <div className="hk-topic-hero-copy">
              <p className="hik-home-eyebrow"><span /> HIKTECH / {topic.label.toUpperCase()}</p>
              <h1 id="hk-topic-title">{topic.title}</h1>
              <p className="hk-topic-description">{topic.description}</p>
              <div className="hk-topic-hero-actions">
                <a href={items[0]?.href ?? '#hk-topic-content'} className="hik-home-primary-cta">Explore this page <ArrowRight size={18} /></a>
                <Link href="/" className="hik-home-secondary-cta"><ArrowLeft size={17} /> Back to home</Link>
              </div>
            </div>
            <aside className="hk-topic-guide hik-home-glass" aria-label="On this page">
              <span className="hk-topic-guide-kicker">FIELD GUIDE <span>{String(index).padStart(2, '0')} / 07</span></span>
              <strong>In this chapter</strong>
              <div>{items.map((item, itemIndex) => <a key={item.href} href={item.href}><span>{String(itemIndex + 1).padStart(2, '0')}</span>{item.label}<ArrowUpRight size={17} /></a>)}</div>
              <p>Explore the details below.</p>
            </aside>
            <div className="hk-topic-hero-bottom"><span>ONE INCIDENT</span><i /><span>EVERY SERVICE</span><i /><span>ONE RECORD</span></div>
          </section>
        )}

        <div id="hk-topic-content" className="hk-topic-content">{children}</div>

        <footer className="hik-home-footer hk-topic-footer">
          <Logo footer />
          <p>Emergency command for the whole response.</p>
          <div><Link href="/">Home</Link>{NAV.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}</div>
          <span>© 2026 Netstream Integrated Solutions</span>
        </footer>
      </div>
    </main>
  );
}
