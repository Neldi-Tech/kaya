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
  async redirects() {
    return [
      // /dashboard → /home. Old route renamed when Discover took the
      // root slot — the 301 keeps every existing bookmark working.
      { source: '/dashboard', destination: '/home', permanent: true },
    ];
  },
};

module.exports = nextConfig;
