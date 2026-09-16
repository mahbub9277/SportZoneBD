/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        'surface-soft': 'var(--surface-soft)',
        'surface-strong': 'var(--surface-strong)',
        card: 'var(--card)',
        border: 'var(--border)',
        brand: {
          primary: 'var(--brand-primary)',
          secondary: 'var(--brand-secondary)',
          surface: 'var(--brand-surface)',
          'surface-soft': 'var(--brand-surface-soft)',
          border: 'var(--brand-border)',
          'text-primary': 'var(--brand-text-primary)',
          'text-secondary': 'var(--brand-text-secondary)',
          'text-muted': 'var(--brand-text-muted)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          soft: 'var(--accent-soft)',
          muted: 'var(--accent-muted)',
          secondary: 'var(--accent-secondary)',
        },
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'splash': {
          'tagline': '#A8C4EC',
          'progress-label': '#7BA4CF',
          'version': '#5379AE',
        },
        'admin': {
          'text-light': '#F0F2F7',
        }
      },
      boxShadow: {
        glow: '0 12px 44px rgba(240, 180, 40, 0.24)',
        soft: '0 22px 64px rgba(4, 8, 16, 0.22)',
        premium: '0 28px 90px rgba(0, 0, 0, 0.26)',
        'sidebar-panel': '0 30px 80px rgba(0, 0, 0, 0.18)',
        'sidebar-panel-glow': '0 25px 70px rgba(255, 199, 0, 0.12)',
        'sidebar-nav-hover': '0 18px 60px rgba(255, 199, 0, 0.12)',
        'sidebar-nav-active': '0 24px 80px rgba(255, 199, 0, 0.16)',
        'nav-active': '0 8px 20px rgba(10, 12, 28, 0.08)',
        'admin-avatar': '0 10px 30px rgba(255, 199, 0, 0.1)', // Specific shadow for admin avatar
        'back-to-top-hover': '0 20px 50px rgba(255, 199, 0, 0.1)',
        'sidebar': '24px 0 90px rgba(0, 0, 0, 0.32)',
      },
      borderRadius: {
        none: '0',
        sm: '0.5rem',
        DEFAULT: '0.75rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
        'panel': '1.75rem',
        '4xl': '2.5rem',
        full: '9999px',
      },
      zIndex: {
        'splash': '9999',
      },
      fontSize: {
        display: ['clamp(3.8rem, 6.6vw, 5.8rem)', { lineHeight: '1.05', letterSpacing: '-0.04em', fontWeight: '700' }],
        h1: ['clamp(2.7rem, 4.7vw, 3.9rem)', { lineHeight: '1.08', letterSpacing: '-0.03em', fontWeight: '600' }],
        h2: ['clamp(2.2rem, 3.7vw, 3.2rem)', { lineHeight: '1.16', letterSpacing: '-0.02em', fontWeight: '600' }],
        h3: ['clamp(1.7rem, 2.9vw, 2.35rem)', { lineHeight: '1.24', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['1.05rem', { lineHeight: '1.8', fontWeight: '400' }],
        'body-sm': ['0.92rem', { lineHeight: '1.6', fontWeight: '400' }],
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        // Add your custom font family here
        satoshi: ['Satoshi', 'sans-serif'],
      },
      animation: {
        'float-slow': 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 3s ease-in-out infinite',
        shake: 'shake 0.5s ease-in-out',
        shimmer: 'shimmer 1.5s infinite',
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        wave: 'wave 0.9s infinite ease-in-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.7 },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0) rotate(0deg)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-2px) rotate(-1deg)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(2px) rotate(1deg)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': {
            transform: 'scale(.33)',
            opacity: '0.8',
          },
          '80%, 100%': { transform: 'scale(1.2)', opacity: '0' },
        },
        wave: {
          '0%, 40%, 100%': { transform: 'scaleY(0.4)' },
          '20%': { transform: 'scaleY(1)' },
        },
      },
    },
  },
  plugins: [
    plugin(function ({ addComponents, theme }) {
      addComponents({
        '.btn': {
          padding: `${theme('spacing.2')} ${theme('spacing.6')}`,
          borderRadius: theme('borderRadius.md'),
          fontWeight: theme('fontWeight.semibold'),
          transition: 'all 0.2s ease-in-out',
          '&:focus-visible': {
            outline: '2px solid transparent',
            outlineOffset: '2px',
            boxShadow: `0 0 0 3px ${theme('colors.accent.DEFAULT')}55`,
          },
        },
        '.btn-primary': {
          backgroundColor: theme('colors.accent.DEFAULT'),
          color: 'white',
          boxShadow: `0 8px 30px ${theme('colors.accent.DEFAULT')}44`,
          '&:hover': {
            backgroundColor: theme('colors.accent.strong'),
            transform: 'translateY(-1px)',
          },
        },
        '.glass-panel': {
          background: 'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
          backdropFilter: 'blur(22px)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.16)',
        },
        '.section-shell': {
          borderRadius: '1.5rem',
          border: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.16)',
        },
        '.admin-sidebar-bg-dark': {
          background:
            'radial-gradient(circle at top left, rgba(255, 199, 0, 0.14), transparent 30%), linear-gradient(180deg, #05070f, #0b1221)',
        },
        '.admin-sidebar-bg-light': {
          background:
            'radial-gradient(circle at top left, rgba(255, 199, 0, 0.08), transparent 30%), linear-gradient(180deg, #f0f2f7, #ffffff)',
        },
        '.bg-admin-nav-active-dark': { background: 'linear-gradient(to right, rgba(255,199,0,0.1), rgba(255,255,255,0.05), rgba(255,255,255,0.05))' },
        '.bg-admin-nav-active-light': { background: 'linear-gradient(to right, rgba(255,199,0,0.08), rgba(0,0,0,0.02), rgba(0,0,0,0.02))' },
        '.splash-bg-standard': {
          background: 'radial-gradient(circle at top, rgba(59,130,246,0.18), transparent 42%), linear-gradient(135deg, #0f172a 0%, #111827 44%, #1e293b 100%)',
        },
        '.splash-bg-premium': {
          background: 'radial-gradient(circle at top, rgba(34,211,238,0.16), transparent 38%), linear-gradient(135deg, rgba(12,18,55,0.98) 0%, rgba(18,40,91,0.96) 42%, rgba(8,15,32,1) 100%)',
        },
        '.splash-progress-bar': {
          background: 'linear-gradient(90deg, #0474C4, #A8C4EC)',
        },
        '.auth-bg-light': {
          background: 'radial-gradient(circle at top left,rgba(34,211,238,0.22),transparent_42%),radial-gradient(circle at bottom right,rgba(129,140,248,0.24),transparent_38%),linear-gradient(135deg,rgba(248,250,252,0.98),rgba(226,232,240,0.95))',
        },
        '.auth-bg-dark': {
          background: 'radial-gradient(circle at top left,rgba(34,211,238,0.16),transparent_40%),radial-gradient(circle at bottom right,rgba(168,85,247,0.2),transparent_35%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(15,23,42,0.95))',
        },
        '.btn-auth-gradient': {
          background: 'linear-gradient(to right, #06b6d4, #3b82f6)',
        },
      })
    }),
  ],
}
