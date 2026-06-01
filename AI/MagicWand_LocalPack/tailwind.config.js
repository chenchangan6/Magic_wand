/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index_ui_rebuild.html',
    './index_ui_rebuild.js'
  ],
  theme: {
    extend: {
      colors: {
        mw: {
          bg: '#08111d',
          panel: '#121b29',
          panel2: '#111927',
          panel3: '#0e141f',
          line: 'rgba(88, 116, 154, 0.34)',
          text: '#eef4ff',
          muted: '#9cadc6',
          blue: '#4ba9ff',
          blueSoft: '#7ec6ff',
          green: '#43d17a',
          greenSoft: '#6be29d',
          yellow: '#f3c44d',
          purple: '#a966ff',
          red: '#ef6a78'
        }
      },
      borderRadius: {
        mwLg: '22px',
        mwMd: '16px',
        mwSm: '12px'
      },
      boxShadow: {
        mw: '0 16px 44px rgba(0, 0, 0, 0.34)'
      }
    }
  },
  plugins: []
};
