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
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'kaya': '16px',
        'kaya-sm': '10px',
        'kaya-lg': '24px',
      },
    },
  },
  plugins: [],
};
