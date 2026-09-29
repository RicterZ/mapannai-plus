import { NextRequest, NextResponse } from 'next/server'
import { mapProviderFactory } from '@/lib/map/providers'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { latitude, longitude } = body
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return NextResponse.json({ error: '需要有效坐标' }, { status: 400 })
        const provider = mapProviderFactory.createServiceProvider('details')
        const result = await provider.getPlaceDetails({ latitude, longitude })
        return NextResponse.json({ success: true, data: result })
    } catch (error) {
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '地图服务请求失败' }, { status: 500 })
    }
}
