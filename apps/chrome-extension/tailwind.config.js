/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#060816',
        primary: '#8B5CF6',
        secondary: '#06B6D4',
        accent: '#F0ABFC',
      },
      animation: {
        'float': 'float 3s ease-in-out infinite',
        'bounce-slow': 'bounce 2s infinite',
        'pulse-slow': 'pulse 3s infinite',
        'drop': 'drop 0.6s ease-out',
        'squash': 'squash 0.3s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        drop: {
          '0%': { transform: 'translateY(-100px) scale(1)' },
          '70%': { transform: 'translateY(10px) scale(1.05)' },
          '100%': { transform: 'translateY(0) scale(1)' },
        },
        squash: {
          '0%': { transform: 'scaleY(1)' },
          '50%': { transform: 'scaleY(0.8) scaleX(1.2)' },
          '100%': { transform: 'scaleY(1) scaleX(1)' },
        },
      },
    },
  },
  plugins: [],
}