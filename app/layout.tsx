import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '$SHELL · Solana security vault', description: 'Solana vault with one-time signing keys and automatic rotation. New vault activation: 0.01 SOL. Experimental authorization; network fees and account rent apply.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-appearance="light" suppressHydrationWarning><head><meta httpEquiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.devnet.solana.com https://solana-rpc.publicnode.com; object-src 'none'; base-uri 'none'; form-action 'none'"/><meta name="referrer" content="no-referrer"/><script id="shell-appearance" dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.appearance=localStorage.getItem('shell-appearance')==='dark'?'dark':'light'}catch{document.documentElement.dataset.appearance='light'}" }}/></head><body>{children}</body></html>;
}
