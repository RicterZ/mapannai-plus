import { NextRequest, NextResponse } from 'next/server'
import { getDayById, upsertTripDay } from '@/lib/db/trip-service'

export const dynamic = 'force-dynamic'

// POST /api/trips/[id]/days/[dayId]/markers — add marker to this day
export async function POST(request: NextRequest, { params }: { params: { id: string; dayId: string } }) {
    try {
        const body = await request.json()
        const { markerId } = body
        if (!markerId) return NextResponse.json({ error: 'markerId 不能为空' }, { status: 400 })

        const day = getDayById(params.dayId)
        if (!day || day.tripId !== params.id) return NextResponse.json({ error: '天不存在' }, { status: 404 })

        if (!day.markerIds.includes(markerId)) {
            upsertTripDay({ ...day, markerIds: [...day.markerIds, markerId] })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('添加标记到天失败:', error)
        return NextResponse.json({ error: '添加标记到天失败' }, { status: 500 })
    }
}

// DELETE /api/trips/[id]/days/[dayId]/markers — remove marker from this day
export async function DELETE(request: NextRequest, { params }: { params: { id: string; dayId: string } }) {
    try {
        const { markerId } = await request.json()
        if (!markerId) return NextResponse.json({ error: 'markerId 不能为空' }, { status: 400 })

        const day = getDayById(params.dayId)
        if (day && day.tripId === params.id) {
            upsertTripDay({ ...day, markerIds: day.markerIds.filter(id => id !== markerId), chains: day.chains.map(chain => chain.filter(id => id !== markerId)).filter(chain => chain.length > 0) })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('从天移除标记失败:', error)
        return NextResponse.json({ error: '从天移除标记失败' }, { status: 500 })
    }
}
