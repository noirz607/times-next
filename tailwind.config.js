/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 低饱和的华师红，只作为点缀色使用
        ecnu: {
          50: '#faf3f3',
          100: '#f2e3e4',
          200: '#e2c3c6',
          300: '#cb999e',
          400: '#ad6770',
          500: '#8f3f4a',
          600: '#7a2c38',
          700: '#62222d',
          800: '#4a1b23',
          900: '#34141a',
        },
        gold: {
          100: '#f4ecdc',
          200: '#e9dabb',
          300: '#d9c39a',
          400: '#c3a46b',
          500: '#a8874a',
        },
        paper: '#f6f4ef',
        night: {
          DEFAULT: '#121110',
          800: '#1a1817',
          700: '#232120',
          600: '#2e2b29',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei UI"', '"Microsoft YaHei"', 'sans-serif'],
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', '"Songti SC"', '"STSong"', '"SimSun"', 'serif'],
      },
    },
  },
  plugins: [],
}
