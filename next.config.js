/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Baked into the client bundle so UpdatePrompt can compare the running
  // build against the live deployment (/api/version). VERCEL_GIT_COMMIT_SHA
  // changes every deploy; 'dev' locally disables the check.
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || 'dev',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // Digital Asset Links for the Kaya Android app (Trusted Web Activity).
      // Next.js will not route a directory whose name starts with a dot, so
      // the canonical /.well-known/ path is mapped onto an API handler.
      // Without this, Chrome cannot verify the app and the TWA renders with a
      // URL bar across the top. See src/app/api/assetlinks/route.ts.
      { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
    ];
  },
  async redirects() {
    return [
      // /dashboard → /home. Old route renamed when Discover took the
      // root slot — the 301 keeps every existing bookmark working.
      { source: '/dashboard', destination: '/home', permanent: true },
      // /welcome → /. The marketing surface now lives at the root (server-
      // rendered). Keep the legacy path working — query strings (e.g. an
      // invite ?ref=CODE) are preserved by Next on redirect.
      { source: '/welcome', destination: '/', permanent: true },
    ];
  },
};

module.exports = nextConfig;
