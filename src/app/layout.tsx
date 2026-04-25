import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/contexts/AuthContext';
import { FamilyProvider } from '@/contexts/FamilyContext';
import './globals.css';

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
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="bg-kaya-cream min-h-screen">
        <AuthProvider>
          <FamilyProvider>
            <div className="mx-auto max-w-md min-h-screen relative">
              {children}
            </div>
          </FamilyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
