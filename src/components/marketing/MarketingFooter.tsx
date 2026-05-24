// Footer — navy-deep, Kaya logo, link row including Sign in (→ /login).
// Static / server-rendered.

import Link from 'next/link';
import KayaIcon from './KayaIcon';

export default function MarketingFooter() {
  return (
    <footer className="site-footer">
      <div className="brand-mini">
        <KayaIcon className="logo-mini" size={28} />
        Kaya
      </div>
      <p>
        Responsible kids. Responsible parents.{' '}
        <Link href="/login">Sign in</Link> ·{' '}
        <a href="#">Privacy</a> ·{' '}
        <a href="#">Terms</a> ·{' '}
        <a href="#">@ourkaya.app</a>
      </p>
      <p className="copyright">© 2026 Kaya. Built on love, for families everywhere.</p>
    </footer>
  );
}
