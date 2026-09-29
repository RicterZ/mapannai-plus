import { getDb } from './index'
import { Trip, TripDay } from '@/types/trip'

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

export function deleteTrip(id: string): void {
    // ON DELETE CASCADE automatically removes associated trip_days
    getDb().prepare(`DELETE FROM trips WHERE id = ?`).run(id)
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
    getDb().prepare(`
        INSERT INTO trip_days (id, trip_id, date, title, marker_ids, chains)
        VALUES (@id, @tripId, @date, @title, @markerIds, @chains)
        ON CONFLICT(id) DO UPDATE SET
            date       = excluded.date,
            title      = excluded.title,
            marker_ids = excluded.marker_ids,
            chains     = excluded.chains
    `).run({
        id: day.id,
        tripId: day.tripId,
        date: day.date,
        title: day.title ?? null,
        markerIds: JSON.stringify(day.markerIds),
        chains: JSON.stringify(day.chains ?? []),
    })
}

export function deleteTripDay(dayId: string): void {
    getDb().prepare(`DELETE FROM trip_days WHERE id = ?`).run(dayId)
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
        markerIds: JSON.parse(row.marker_ids || '[]'),
        chains: JSON.parse(row.chains || '[]'),
    }
}
