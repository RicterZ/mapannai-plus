import { NextRequest, NextResponse } from 'next/server'
import { setTripMarker } from '@/lib/db/trip-service'
export const dynamic = 'force-dynamic'
async function change(request: NextRequest, id: string, add: boolean) {
    try {
        const { markerId } = await request.json()
        if (typeof markerId !== 'string' || !markerId) throw new Error('地点 ID 无效')
        return NextResponse.json(setTripMarker(id, markerId, add))
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : '更新旅行地点失败' }, { status: 400 })
    }
}
export async function POST(request: NextRequest, { params }: { params: { id: string } }) { return change(request, params.id, true) }
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) { return change(request, params.id, false) }
