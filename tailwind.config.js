/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#007bff',
        secondary: '#27ae60',
        error: '#e74c3c',
      },
      boxShadow: {
        card: '0 6px 20px rgba(0, 0, 0, 0.1)',
      },
      animation: {
        fadeIn: 'fadeIn 0.5s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    // Nếu vẫn lỗi, hãy tạm comment dòng dưới lại để kiểm tra
    // require('@tailwindcss/forms'),
  ],
}