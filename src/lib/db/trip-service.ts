import { getDb } from './index'
import { Trip, TripDay } from '@/types/trip'
import { exclusiveMarkerIds } from '@/lib/trip-deletion'
import { deleteMarker, getMarkerById } from './marker-service'

// ── Trip ──────────────────────────────────────────────

export function getAllTrips(): Trip[] {
    return (getDb().prepare(`SELECT * FROM trips ORDER BY created_at DESC`).all() as any[]).map(rowToTrip)
}

export function getTripById(id: string): Trip | null {
    const row = getDb().prepare(`SELECT * FROM trips WHERE id = ?`).get(id) as any
    return row ? rowToTrip(row) : null
}

export function upsertTrip(trip: Trip): void {
    getDb().prepare(`
        INSERT INTO trips (id, name, description, start_date, end_date, cover_image, emoji, created_at, updated_at)
        VALUES (@id, @name, @description, @startDate, @endDate, @coverImage, @emoji, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
            name        = excluded.name,
            description = excluded.description,
            start_date  = excluded.start_date,
            end_date    = excluded.end_date,
            cover_image = excluded.cover_image,
            emoji       = excluded.emoji,
            updated_at  = excluded.updated_at
    `).run({
        id: trip.id,
        name: trip.name,
        description: trip.description ?? null,
        startDate: trip.startDate,
        endDate: trip.endDate,
        coverImage: trip.coverImage ?? null,
        emoji: trip.emoji ?? null,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
    })
}

export function moveTripStartDate(trip: Trip, startDate: string): { trip: Trip; days: TripDay[] } {
    const db = getDb()
    return db.transaction(() => {
        const days = getTripDays(trip.id)
        const start = new Date(`${startDate}T00:00:00Z`)
        const dayCount = days.length || Math.round((Date.parse(`${trip.endDate}T00:00:00Z`) - Date.parse(`${trip.startDate}T00:00:00Z`)) / 86400000) + 1
        const dateAt = (offset: number) => new Date(start.getTime() + offset * 86400000).toISOString().slice(0, 10)
        const updated = { ...trip, startDate, endDate: dateAt(Math.max(dayCount - 1, 0)), updatedAt: new Date().toISOString() }
        upsertTrip(updated)
        const updateDay = db.prepare('UPDATE trip_days SET date = ? WHERE id = ?')
        days.forEach((day, index) => updateDay.run(dateAt(index), day.id))
        return { trip: updated, days: days.map((day, index) => ({ ...day, date: dateAt(index) })) }
    })()
}

export function deleteTrip(id: string, deleteExclusiveMarkers = false): { deletedMarkerIds: string[] } {
    return getDb().transaction(() => {
        const ids = deleteExclusiveMarkers ? exclusiveMarkerIds(getTripDays(id), getAllTripDays()) : []
        getDb().prepare('DELETE FROM trips WHERE id = ?').run(id)
        ids.forEach(deleteMarker)
        return { deletedMarkerIds: ids }
    })()
}

// ── TripDay ───────────────────────────────────────────

export function getTripDays(tripId: string): TripDay[] {
    return (getDb().prepare(`SELECT * FROM trip_days WHERE trip_id = ? ORDER BY date ASC`).all(tripId) as any[]).map(rowToDay)
}

export function getAllTripDays(): TripDay[] {
    return (getDb().prepare(`SELECT * FROM trip_days ORDER BY date ASC`).all() as any[]).map(rowToDay)
}

export function getDayById(dayId: string): TripDay | null {
    const row = getDb().prepare(`SELECT * FROM trip_days WHERE id = ?`).get(dayId) as any
    return row ? rowToDay(row) : null
}

export function upsertTripDay(day: TripDay): void {
    const existing = getDayById(day.id)
    const used = new Set(getTripDays(day.tripId).map(day => day.colorIndex))
    let colorIndex = 0
    while (used.has(colorIndex)) colorIndex++
    day.colorIndex = existing?.colorIndex ?? colorIndex
    getDb().prepare(`
        INSERT INTO trip_days (id, trip_id, date, title, emoji, marker_ids, chains, color_index)
        VALUES (@id, @tripId, @date, @title, @emoji, @markerIds, @chains, @colorIndex)
        ON CONFLICT(id) DO UPDATE SET
            date       = excluded.date,
            title      = excluded.title,
            emoji      = excluded.emoji,
            marker_ids = excluded.marker_ids,
            chains     = excluded.chains
    `).run({
        id: day.id,
        tripId: day.tripId,
        date: day.date,
        title: day.title ?? null,
        emoji: day.emoji ?? null,
        colorIndex: day.colorIndex,
        markerIds: JSON.stringify(day.markerIds),
        chains: JSON.stringify(day.chains ?? []),
    })
}

/** Replace or remove one route while preserving day membership and other routes. */
export function editDayChain(tripId: string, dayId: string, chainIndex: number, markerIds: string[] | null): TripDay {
    return getDb().transaction(() => {
        const day = getDayById(dayId)
        if (!day || day.tripId !== tripId) throw new Error(`天不存在: ${dayId}`)
        if (!Number.isInteger(chainIndex) || chainIndex < 0 || chainIndex >= day.chains.length) throw new Error('路线索引无效，请查询最新行程')
        if (markerIds !== null) {
            if (markerIds.length < 2) throw new Error('路线至少需要两个地点；删除路线请使用 delete_day_chain')
            if (new Set(markerIds).size !== markerIds.length) throw new Error('行程链中不能重复使用同一个标记 ID')
            const missing = markerIds.filter(id => !getMarkerById(id))
            if (missing.length) throw new Error(`标记不存在: ${missing.join(', ')}`)
        }
        const updated: TripDay = {
            ...day,
            markerIds: markerIds === null ? day.markerIds : [...day.markerIds, ...markerIds.filter(id => !day.markerIds.includes(id))],
            chains: markerIds === null ? day.chains.filter((_, index) => index !== chainIndex)
                : day.chains.map((chain, index) => index === chainIndex ? markerIds : chain),
        }
        upsertTripDay(updated)
        return updated
    })()
}

export function deleteTripDay(dayId: string): void {
    getDb().prepare(`DELETE FROM trip_days WHERE id = ?`).run(dayId)
}

export function removeTripDayAndCloseGap(tripId: string, dayId: string, deleteExclusiveMarkers = false): { trip: Trip; days: TripDay[]; deletedMarkerIds: string[] } {
    const db = getDb()
    return db.transaction(() => {
        const trip = getTripById(tripId)
        if (!trip) throw new Error('旅行不存在')
        const days = getTripDays(tripId)
        if (days.length <= 1) throw new Error('行程至少保留一天')
        if (!days.some(day => day.id === dayId)) throw new Error('行程日不存在')

        const deletedMarkerIds = deleteExclusiveMarkers ? exclusiveMarkerIds(days.filter(day => day.id === dayId), getAllTripDays()) : []
        db.prepare('DELETE FROM trip_days WHERE id = ? AND trip_id = ?').run(dayId, tripId)
        deletedMarkerIds.forEach(deleteMarker)
        const remaining = days.filter(day => day.id !== dayId)
        const start = Date.parse(`${trip.startDate}T00:00:00Z`)
        const dateAt = (index: number) => new Date(start + index * 86400000).toISOString().slice(0, 10)
        const updateDay = db.prepare('UPDATE trip_days SET date = ? WHERE id = ?')
        const updatedDays = remaining.map((day, index) => {
            const date = dateAt(index)
            updateDay.run(date, day.id)
            return { ...day, date }
        })
        const updatedTrip = { ...trip, endDate: dateAt(remaining.length - 1), updatedAt: new Date().toISOString() }
        upsertTrip(updatedTrip)
        return { trip: updatedTrip, days: updatedDays, deletedMarkerIds }
    })()
}

// ── Row mappers ───────────────────────────────────────

function rowToTrip(row: any): Trip {
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        startDate: row.start_date,
        endDate: row.end_date,
        coverImage: row.cover_image ?? undefined,
        emoji: row.emoji ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

function rowToDay(row: any): TripDay {
    return {
        id: row.id,
        tripId: row.trip_id,
        date: row.date,
        title: row.title ?? undefined,
        emoji: row.emoji ?? undefined,
        colorIndex: row.color_index,
        markerIds: JSON.parse(row.marker_ids || '[]'),
        chains: JSON.parse(row.chains || '[]'),
    }
}
