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
