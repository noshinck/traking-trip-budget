/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    // Status beacon dynamic color classes
    'bg-emerald-50', 'border-emerald-500', 'text-emerald-700', 'shadow-emerald-100',
    'bg-amber-50',   'border-amber-500',   'text-amber-700',   'shadow-amber-100',
    'bg-sky-50',     'border-sky-500',     'text-sky-700',     'shadow-sky-100',
    'bg-rose-50',    'border-rose-500',    'text-rose-700',    'shadow-rose-100',
    // Traffic light glow shadows
    'shadow-emerald-500/50', 'shadow-amber-500/50', 'shadow-rose-500/50',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
