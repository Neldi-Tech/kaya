import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Nunito, Lato } from 'next/font/google';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider } from '@/contexts/AuthContext';
import { FamilyProvider } from '@/contexts/FamilyContext';
import { HiveProvider } from '@/contexts/HiveContext';
import { PantryProvider } from '@/contexts/PantryContext';
import UpdatePrompt from '@/components/UpdatePrompt';
import './globals.css';

// The Hive section uses Nunito (display) + Lato (body) per the v2 design
// proposal. Loaded once at the root and exposed as CSS variables so any
// Hive component can opt in via `font-nunito` / `font-lato` Tailwind
// utilities — non-Hive routes keep their existing typography.
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-nunito',
  display: 'swap',
});
const lato = Lato({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-lato',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Kaya — Where Families Grow',
  description: 'Family house points system. Rate routines, award points, build character together.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Kaya',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1E120B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${lato.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="bg-kaya-cream min-h-screen">
        <Script id="register-sw" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
              window.addEventListener('load', function () {
                navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(function () {});
              });
            }
          `}
        </Script>
        <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''}>
          <AuthProvider>
            <FamilyProvider>
              <HiveProvider>
                <PantryProvider>
                  {children}
                  <UpdatePrompt />
                </PantryProvider>
              </HiveProvider>
            </FamilyProvider>
          </AuthProvider>
        </GoogleOAuthProvider>
      </body>
    </html>
  );
}
