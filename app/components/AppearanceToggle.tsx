'use client';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'shell-appearance';

export default function AppearanceToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.dataset.appearance === 'dark');
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const next = event.newValue === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.appearance = next;
      setDark(next === 'dark');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.appearance === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.appearance = next;
    setDark(next === 'dark');
    // Appearance is non-secret. Blocked preference storage must not break the UI.
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }

  return <button type="button" className="appearance-toggle" role="switch" aria-label="Dark mode" aria-checked={dark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggle}>
    <svg className="appearance-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z"/></svg>
    <svg className="appearance-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  </button>;
}
