import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: { z: string; x: string; y: string } }) {
    const z = Number(params.z)
    const x = Number(params.x)
    const y = Number(params.y)
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 18 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
        return new NextResponse('Invalid tile coordinates', { status: 400 })
    }

    const upstream = new URL('https://webrd01.is.autonavi.com/appmaptile')
    upstream.search = new URLSearchParams({ lang: 'zh_cn', size: '1', scale: '1', style: '7', x: String(x), y: String(y), z: String(z) }).toString()
    try {
        const response = await fetch(upstream, { next: { revalidate: 3600 } })
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
            return new NextResponse('Tile unavailable', { status: 502 })
        }
        return new NextResponse(response.body, {
            headers: {
                'Content-Type': response.headers.get('content-type') || 'image/png',
                'Cache-Control': 'public, max-age=3600, s-maxage=3600',
            },
        })
    } catch {
        return new NextResponse('Tile unavailable', { status: 502 })
    }
}
