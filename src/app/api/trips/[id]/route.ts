import { NextRequest, NextResponse } from 'next/server'
import { getTripById, upsertTrip, deleteTrip, getTripDays, moveTripStartDate } from '@/lib/db/trip-service'

export const dynamic = 'force-dynamic'

// GET /api/trips/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const trip = getTripById(params.id)
        if (!trip) return NextResponse.json({ error: '旅行不存在' }, { status: 404 })

        const days = getTripDays(params.id)
        return NextResponse.json({ ...trip, days })
    } catch (error) {
        console.error('获取旅行详情失败:', error)
        return NextResponse.json({ error: '获取旅行详情失败' }, { status: 500 })
    }
}

// PUT /api/trips/[id]
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const trip = getTripById(params.id)
        if (!trip) return NextResponse.json({ error: '旅行不存在' }, { status: 404 })

        const body = await request.json()
        // Membership changes use the dedicated markers endpoint.
        delete body.description // Retired trip-level notes; ignore legacy clients.
        delete body.markerIds
        if (body.startDate !== undefined && body.startDate !== trip.startDate) {
            const startDate = body.startDate
            const parsedDate = typeof startDate === 'string' ? new Date(`${startDate}T00:00:00Z`) : new Date(NaN)
            if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
                !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== startDate) {
                return NextResponse.json({ error: '开始日期无效' }, { status: 400 })
            }
            const { trip: updated, days } = moveTripStartDate({ ...trip, ...body, id: trip.id, startDate: trip.startDate, endDate: trip.endDate }, startDate)
            return NextResponse.json({ ...updated, days })
        }
        const updated = {
            ...trip,
            ...body,
            id: trip.id, // immutable
            updatedAt: new Date().toISOString(),
        }

        upsertTrip(updated)
        return NextResponse.json(updated)
    } catch (error) {
        console.error('更新旅行失败:', error)
        return NextResponse.json({ error: '更新旅行失败' }, { status: 500 })
    }
}

// DELETE /api/trips/[id] — deletes trip and all its days (CASCADE)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        // deleteTrip cascades to trip_days via ON DELETE CASCADE
        const result = deleteTrip(params.id, _req.nextUrl.searchParams.get('deleteExclusiveMarkers') === 'true')

        return NextResponse.json({ success: true, ...result })
    } catch (error) {
        console.error('删除旅行失败:', error)
        return NextResponse.json({ error: '删除旅行失败' }, { status: 500 })
    }
}
