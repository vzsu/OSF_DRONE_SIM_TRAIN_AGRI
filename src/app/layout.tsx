import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import 'leaflet/dist/leaflet.css';
import 'katex/dist/katex.min.css';
import './globals.css';

// Google font pairing, self-hosted by next/font at build time (works offline on the LAN):
// Space Grotesk — headings (same pairing as OSF Drone Learning OS)
// Instrument Sans — clean, compact UI text
// JetBrains Mono — telemetry, coordinates, tabular readouts
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap', weight: ['500', '600', '700'] });
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap', weight: ['400', '500', '600', '700'] });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap', weight: ['400', '600'] });

export const metadata: Metadata = {
  title: 'OSF Agri Flight Trainer',
  description: 'Agricultural drone flight training simulator with RC transmitter support',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
