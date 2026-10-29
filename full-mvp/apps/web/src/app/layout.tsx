import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { RegisterSW } from '@/components/pwa';

export const metadata: Metadata = {
  title: { default: 'Agenda de citas', template: '%s · Agenda de citas' },
  description: 'Reserva citas en linea y administra tu agenda con recordatorios por WhatsApp.',
  applicationName: 'Agenda de citas',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Agenda', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#7c3aed',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
        <RegisterSW />
      </body>
    </html>
  );
}
