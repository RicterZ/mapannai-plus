import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter, DM_Serif_Display } from 'next/font/google'
import { Toaster } from 'sonner'
import { AuthModal } from '@/components/auth/auth-modal'

const inter = Inter({ subsets: ['latin'] })
const dmSerifDisplay = DM_Serif_Display({
    subsets: ['latin'],
    weight: '400',
    variable: '--font-dm-serif',
})

export const metadata: Metadata = {
    title: 'マップ案内 Plus - 交互式地图 AI 编辑器',
    description: '交互式地图标记编辑平台，支持富文本内容编辑和多人协作，支持AI聊天和生成计划',
    keywords: ['地图', '编辑器', '标记', 'maplibre', '交互式', 'マップ案内', 'AI', '聊天', '旅游计划'],
    authors: [{ name: 'マップ案内 Team, Ricter Z' }],
    manifest: '/manifest.json',
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: '32x32' },
            { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
            { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
        apple: '/apple-touch-icon.png',
    },
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'マップ案内',
    },
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="zh-CN">
            <body className={`${inter.className} ${dmSerifDisplay.variable}`}>
                {children}
                <Toaster position="top-center" richColors closeButton />
                <AuthModal />
            </body>
        </html>
    )
}
