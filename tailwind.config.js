/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
        './src/types/**/*.{ts,tsx}',
    ],
    safelist: [
        // 供 markers 使用的类型颜色（生产环境防止被清理）
        'bg-orange-500/75', 'hover:bg-orange-500',
        'bg-pink-500/75', 'hover:bg-pink-500',
        'bg-green-500/75', 'hover:bg-green-500',
        'bg-purple-500/75', 'hover:bg-purple-500',
        'bg-zinc-500/75', 'hover:bg-zinc-500',
        'bg-slate-500/75', 'hover:bg-slate-500',
        'bg-fuchsia-500/75', 'hover:bg-fuchsia-500',
        'bg-gray-500/75', 'hover:bg-gray-500',
        'bg-blue-500/75', 'hover:bg-blue-500',
        'bg-sky-500/50', 'hover:bg-sky-500',
    ],
    theme: {
        extend: {
            colors: {
                accent: {
                    50: '#f0f8fa', 100: '#e0f1f4', 200: '#c3e3e9', 300: '#9acbd5',
                    400: '#72aab7', 500: '#548b99', 600: '#426f7b', 700: '#365b65',
                    800: '#2d4a52', 900: '#273e45',
                },
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'gradient-conic':
                    'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
            },
            animation: {
                'slide-in-right': 'slideInRight 0.25s ease-out',
                'slide-in-left': 'slideInLeft 0.25s ease-out',
                'slide-in-bottom': 'slideInBottom 0.3s ease-out',
                'fade-in': 'fadeIn 0.2s ease-out',
                'pop-in': 'popIn 0.3s ease-out',
            },
            keyframes: {
                slideInRight: {
                    '0%': { transform: 'translateX(100%)' },
                    '100%': { transform: 'translateX(0)' },
                },
                slideInLeft: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(0)' },
                },
                slideInBottom: {
                    '0%': { transform: 'translateY(100%)' },
                    '100%': { transform: 'translateY(0)' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                popIn: {
                    '0%': { opacity: '0', transform: 'scale(0.8) translateY(-10px)' },
                    '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
                },
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
        require('@tailwindcss/line-clamp'),
    ],
} 