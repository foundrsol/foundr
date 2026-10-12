import AppearanceToggle from './AppearanceToggle';

export default function SiteNavigation({ current }: { current?: 'wallet' | 'guide' }) {
  return <nav aria-label="SHELL navigation">
    <a href="/" className={current === 'wallet' ? 'nav-active' : undefined} aria-current={current === 'wallet' ? 'page' : undefined}>Wallet</a>
    <a href="/how-it-works" className={current === 'guide' ? 'nav-active' : undefined} aria-current={current === 'guide' ? 'page' : undefined}>How it Works</a>
    <AppearanceToggle/>
  </nav>;
}
