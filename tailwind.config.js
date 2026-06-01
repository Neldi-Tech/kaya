/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        kaya: {
          gold: '#D4A017',
          'gold-light': '#F5E6B8',
          'gold-dark': '#B8860B',
          cream: '#FDFBF7',
          chocolate: '#1E120B',
          'chocolate-light': '#3D241A',
          warm: '#F0EBE3',
          'warm-dark': '#E8E0D4',
          sand: '#9B8A72',
          'sand-light': '#C4B89A',
        },
        house: {
          golden: '#D4A017',
          white: '#7B9DB7',
          silver: '#9B8EC4',
        },
        // ── The Hive · scoped tokens from the v2 design proposal so they
        //    don't collide with the existing kaya-* palette. Use these
        //    only inside /hive routes and shared Hive components.
        hive: {
          honey: '#F39C2F',
          'honey-dk': '#D17F1A',
          'honey-soft': '#FCD9A0',
          navy: '#1F2D3D',
          ink: '#0F1822',
          cream: '#FFF8EC',
          paper: '#FFFFFF',
          muted: '#5C6975',
          line: '#E8DEC9',
          green: '#3FAF6C',
          rose: '#E36F6F',
          blue: '#3F7AAF',
        },
        // ── Brand · the real Kaya marketing palette (from
        //    kaya-brand-sheet.svg). Honey/navy/cream — used by the public
        //    marketing surface (/) and the /login page. Same hexes the
        //    hive-* tokens carry, but named for the brand so marketing +
        //    auth read clearly. The landing page itself uses a route-scoped
        //    stylesheet (see src/app/(marketing)/marketing.css); these
        //    Tailwind tokens cover login + any utility usage.
        brand: {
          honey: '#F39C2F',
          'honey-dk': '#D17F1A',
          'honey-soft': '#FBC675',
          navy: '#1F2D3D',
          'navy-soft': '#2A3D55',
          ink: '#0F1822',
          cream: '#FFF8EC',
          'cream-warm': '#F8EED4',
          coral: '#E85C5C',
        },
        // ── The Pantry (Soko) · leaf-green section accents, sharing the
        //    cream/line/paper neutrals with The Hive so the family of
        //    sections feels cohesive. Pantry-only colour is `leaf-*`.
        pantry: {
          leaf: '#5BA88C',
          'leaf-dk': '#3F7A66',
          'leaf-soft': '#C9E5D7',
        },
        // ── Kaya Pulse · scoped tokens (2026-05-22). Premium navy/gold for
        //    parent finance surfaces; the `joy-*` playful set for kid/helper
        //    logging screens. Scoped like hive-*/pantry-* — never overwrites
        //    kaya-*. Use only inside /pulse routes + Pulse components.
        pulse: {
          navy: '#0F1F44',
          gold: '#D4A847',
          'gold-dk': '#B58A2F',
          cream: '#FBF7EE',
          bone: '#FFFCF5',
          coral: '#E85C5C',
          green: '#2E7D34',
          'joy-coral': '#FF6B6B',
          'joy-yellow': '#FFD93D',
          'joy-green': '#6BCB77',
          'joy-purple': '#9B5DE5',
          'joy-mint': '#4ECDC4',
          'joy-ink': '#2D1B5E',
        },
        // ── Kaya Games · "planet" scoped palette (2026-05-31). The approved
        //    Games design genome — violet/coral/teal — kept as a scoped block
        //    like hive-*/pulse-*/brand-* so it never overwrites kaya-*. Use
        //    only inside /games routes + Games components. (Distinct from the
        //    `universe` MODULE id, which is the app-wide guided tour.)
        games: {
          violet: '#6B3FE0',
          'violet-deep': '#4A1FB8',
          coral: '#FF6B6B',
          gold: '#FFC93C',
          teal: '#2DD4BF',
          mint: '#A7F3D0',
          pink: '#FF8FB1',
          sky: '#7DD3FC',
          ink: '#1A1240',
          'ink-soft': '#5A4F7A',
          bg: '#F5F0FF',
          card: '#FFFFFF',
        },
        // ── Kaya Wealth · "vault" scoped palette (2026-06-01). The
        //    approved Wealth mockup's premium navy/gold/cream register,
        //    with violet = Personal and green = Juniors mode signals.
        //    Scoped like pulse-*/games-* so it never overwrites kaya-*.
        //    Use only inside /wealth routes + Wealth components. The core
        //    navy/gold/cream/green deliberately match pulse-* (shared
        //    premium genome); the rest are Wealth-specific hexes lifted
        //    1:1 from the approved mockup's :root.
        wealth: {
          navy: '#0F1F44',
          'navy-2': '#19306A',
          gold: '#D4A847',
          'gold-soft': '#E7C679',
          cream: '#FBF7EE',
          green: '#2E7D34',
          'green-soft': '#E3F0E4',
          coral: '#E85C5C',
          violet: '#6B4FA0',
          blue: '#2E6FB0',
          ink: '#1A1A1A',
          grey: '#5A5A5A',
          line: '#E7E0D0',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        // ── Hive section uses Nunito (display) + Lato (body) per design.
        nunito: ['var(--font-nunito)', 'system-ui', 'sans-serif'],
        lato: ['var(--font-lato)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'kaya': '16px',
        'kaya-sm': '10px',
        'kaya-lg': '24px',
        // Hive cards lean a bit more rounded than core Kaya cards.
        'hive': '18px',
        'hive-lg': '24px',
        'hive-pill': '999px',
      },
    },
  },
  plugins: [],
};
