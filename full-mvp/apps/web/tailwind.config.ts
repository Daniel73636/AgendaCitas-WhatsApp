import type { Config } from 'tailwindcss';

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        background: hsl('background'),
        foreground: hsl('foreground'),
        card: hsl('card'),
        'card-foreground': hsl('foreground'),
        muted: hsl('muted'),
        'muted-foreground': hsl('muted-foreground'),
        border: hsl('border'),
        ring: hsl('ring'),
        primary: hsl('primary'),
        'primary-foreground': hsl('primary-foreground'),
        secondary: hsl('secondary'),
        'secondary-foreground': hsl('secondary-foreground'),
        destructive: hsl('destructive'),
        'destructive-foreground': hsl('primary-foreground'),
        success: hsl('success'),
        warning: hsl('warning'),
        'warning-foreground': hsl('warning-foreground'),
        info: hsl('info'),
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { transform: 'translateY(24px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'pop-in': { from: { transform: 'scale(0.96)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
      },
      animation: { 'fade-in': 'fade-in .18s ease-out', 'slide-up': 'slide-up .22s ease-out', 'pop-in': 'pop-in .18s ease-out' },
    },
  },
  plugins: [],
};
export default config;
