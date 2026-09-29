import { NextRequest, NextResponse } from 'next/server'
import { getDayById, upsertTripDay, removeTripDayAndCloseGap } from '@/lib/db/trip-service'

export const dynamic = 'force-dynamic'

// PUT /api/trips/[id]/days/[dayId]
export async function PUT(request: NextRequest, { params }: { params: { id: string; dayId: string } }) {
    try {
        const day = getDayById(params.dayId)
        if (!day || day.tripId !== params.id) return NextResponse.json({ error: '天不存在' }, { status: 404 })

        const body = await request.json()
        if (body.emoji !== undefined && (typeof body.emoji !== 'string' || body.emoji.length > 32)) {
            return NextResponse.json({ error: '图标格式无效' }, { status: 400 })
        }
        const updated = {
            ...day,
            emoji: body.emoji !== undefined ? (body.emoji.trim() || undefined) : day.emoji,
            title: body.title !== undefined ? (body.title?.trim() || undefined) : day.title,
            markerIds: body.markerIds !== undefined ? body.markerIds : day.markerIds,
            chains: body.chains !== undefined ? body.chains : day.chains,
            date: body.date || day.date,
        }

        upsertTripDay(updated)
        return NextResponse.json(updated)
    } catch (error) {
        console.error('更新天失败:', error)
        return NextResponse.json({ error: '更新天失败' }, { status: 500 })
    }
}

// DELETE /api/trips/[id]/days/[dayId]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; dayId: string } }) {
    try {
        const day = getDayById(params.dayId)
        if (!day || day.tripId !== params.id) return NextResponse.json({ error: '行程日不存在' }, { status: 404 })
        return NextResponse.json(removeTripDayAndCloseGap(params.id, params.dayId))
    } catch (error) {
        console.error('删除天失败:', error)
        return NextResponse.json({ error: error instanceof Error ? error.message : '删除天失败' }, { status: 400 })
    }
}
