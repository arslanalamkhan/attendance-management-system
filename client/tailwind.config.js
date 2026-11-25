import animate from 'tailwindcss-animate';

const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const semantic = (name) => ({
  DEFAULT: token(name),
  subtle: token(`${name}-subtle`),
  text: token(`${name}-text`),
});

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('foreground') },
        border: { DEFAULT: token('border'), strong: token('border-strong') },
        input: token('input'),
        ring: token('ring'),
        primary: {
          DEFAULT: token('primary'),
          foreground: token('primary-foreground'),
          hover: token('primary-hover'),
          subtle: token('primary-subtle'),
          text: token('primary-text'),
        },
        sidebar: { DEFAULT: token('sidebar'), border: token('sidebar-border') },
        success: semantic('success'),
        warning: semantic('warning'),
        info: semantic('info'),
        danger: { ...semantic('danger'), hover: token('danger-hover'), on: token('danger-on') },
        chart: {
          1: token('chart-1'),
          2: token('chart-2'),
          3: token('chart-3'),
          4: token('chart-4'),
          5: token('chart-5'),
          grid: token('chart-grid'),
        },
      },
      borderColor: { DEFAULT: token('border') },
      ringColor: { DEFAULT: token('ring') },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: 'var(--radius)',
        xl: '14px',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(var(--shadow) / var(--shadow-a1))',
        sm: '0 1px 2px 0 rgb(var(--shadow) / var(--shadow-a1)), 0 1px 3px 0 rgb(var(--shadow) / var(--shadow-a2))',
        md: '0 1px 2px 0 rgb(var(--shadow) / var(--shadow-a1)), 0 4px 12px -2px rgb(var(--shadow) / var(--shadow-a3))',
        lg: '0 2px 4px -2px rgb(var(--shadow) / var(--shadow-a2)), 0 12px 28px -6px rgb(var(--shadow) / var(--shadow-a4))',
        pop: '0 0 0 1px rgb(var(--border) / 0.6), 0 4px 8px -4px rgb(var(--shadow) / var(--shadow-a2)), 0 16px 40px -8px rgb(var(--shadow) / var(--shadow-a4))',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)',
        out: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: { DEFAULT: '150ms' },
      keyframes: {
        'status-ping': {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '100%': { transform: 'scale(2.6)', opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'table-progress': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'status-ping': 'status-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite',
        shimmer: 'shimmer 1.6s infinite',
        'table-progress': 'table-progress 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
};

