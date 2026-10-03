import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getAllTrips, upsertTrip, getAllTripDays, upsertTripDay } from '@/lib/db/trip-service'
import { Trip, TripDay } from '@/types/trip'

export const dynamic = 'force-dynamic'

// GET /api/trips — list all trips
export async function GET() {
    try {
        const trips = getAllTrips()
        const days = getAllTripDays()

        // Attach days to each trip for convenience
        const result = trips
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(trip => ({
                ...trip,
                days: days
                    .filter(d => d.tripId === trip.id)
                    .sort((a, b) => a.date.localeCompare(b.date)),
            }))

        return NextResponse.json(result)
    } catch (error) {
        console.error('获取旅行列表失败:', error)
        return NextResponse.json({ error: '获取旅行列表失败' }, { status: 500 })
    }
}

// POST /api/trips — create a trip and auto-generate TripDay for each day in range
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { name, startDate, endDate } = body

        if (!name?.trim()) return NextResponse.json({ error: '旅行名称不能为空' }, { status: 400 })
        if (!startDate || !endDate) return NextResponse.json({ error: '请提供开始和结束日期' }, { status: 400 })
        if (startDate > endDate) return NextResponse.json({ error: '开始日期不能晚于结束日期' }, { status: 400 })

        const now = new Date().toISOString()
        const tripId = `trip_${uuidv4()}`

        const trip: Trip = {
            id: tripId,
            name: name.trim(),
            startDate,
            endDate,
            createdAt: now,
            updatedAt: now,
        }

        // Auto-generate one TripDay per calendar day
        const days: TripDay[] = []
        const cursor = new Date(startDate)
        const end = new Date(endDate)
        while (cursor <= end) {
            const day: TripDay = {
                id: `day_${uuidv4()}`,
                tripId,
                date: cursor.toISOString().slice(0, 10),
                markerIds: [],
                chains: [],
            }
            days.push(day)
            cursor.setDate(cursor.getDate() + 1)
        }

        // Persist trip and all days (synchronous SQLite)
        upsertTrip(trip)
        days.forEach(d => upsertTripDay(d))

        return NextResponse.json({ ...trip, days })
    } catch (error) {
        console.error('创建旅行失败:', error)
        return NextResponse.json({ error: '创建旅行失败' }, { status: 500 })
    }
}
