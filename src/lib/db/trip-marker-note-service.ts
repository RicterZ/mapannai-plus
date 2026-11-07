import { getDb } from './index'
import { tripMarkerNotePatchSchema } from '@/lib/trips/trip-marker-note'
import type { TripMarkerNote } from '@/types/trip'

export class TripMarkerNoteError extends Error {
    constructor(message: string, public status = 400) { super(message) }
}

export function getTripMarkerNotes(tripId: string): TripMarkerNote[] {
    return getDb().prepare(`SELECT trip_id AS tripId, marker_id AS markerId, title, content, header_image AS headerImage, updated_at AS updatedAt
        FROM trip_marker_notes WHERE trip_id = ? ORDER BY updated_at DESC, marker_id`).all(tripId) as TripMarkerNote[]
}

export function getTripMarkerNote(tripId: string, markerId: string): TripMarkerNote | null {
    return (getDb().prepare(`SELECT trip_id AS tripId, marker_id AS markerId, title, content, header_image AS headerImage, updated_at AS updatedAt
        FROM trip_marker_notes WHERE trip_id = ? AND marker_id = ?`).get(tripId, markerId) as TripMarkerNote | undefined) ?? null
}

function requireTargets(tripId: string, markerId: string) {
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM trips WHERE id = ?').get(tripId)) throw new TripMarkerNoteError('旅行不存在', 404)
    if (!db.prepare('SELECT 1 FROM markers WHERE id = ?').get(markerId)) throw new TripMarkerNoteError('地点不存在', 404)
}

/** Serialize writes and use a monotonic timestamp to detect edits made while an editor was open. */
export function updateTripMarkerNote(tripId: string, markerId: string, input: unknown): TripMarkerNote | null {
    const parsed = tripMarkerNotePatchSchema.safeParse(input)
    if (!parsed.success) throw new TripMarkerNoteError('旅行笔记字段无效')
    const patch = parsed.data
    return getDb().transaction(() => {
        requireTargets(tripId, markerId)
        const existing = getTripMarkerNote(tripId, markerId)
        if (patch.expectedUpdatedAt !== undefined && patch.expectedUpdatedAt !== (existing?.updatedAt ?? null)) {
            throw new TripMarkerNoteError('笔记已被修改，请关闭编辑器并重新打开后再试', 409)
        }
        const title = patch.title === undefined ? existing?.title ?? '' : patch.title ?? ''
        const rawContent = patch.content === undefined ? existing?.content ?? '' : patch.content ?? ''
        const content = rawContent.replace(/<(?:p|br)\b[^>]*>|<\/p>|&nbsp;/gi, '').trim() ? rawContent : ''
        const headerImage = patch.headerImage === undefined ? existing?.headerImage ?? null : patch.headerImage || null
        if (!title && !content.trim() && !headerImage) {
            getDb().prepare('DELETE FROM trip_marker_notes WHERE trip_id = ? AND marker_id = ?').run(tripId, markerId)
            return null
        }
        const updatedAt = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString()
        getDb().prepare(`INSERT INTO trip_marker_notes (trip_id, marker_id, title, content, header_image, updated_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(trip_id, marker_id) DO UPDATE SET
            title = excluded.title, content = excluded.content, header_image = excluded.header_image, updated_at = excluded.updated_at`)
            .run(tripId, markerId, title, content, headerImage, updatedAt)
        return getTripMarkerNote(tripId, markerId)
    }).immediate()
}

/** Copy, never guess which passages are reusable or remove the shared source. */
export function copyPlaceNoteToTrip(tripId: string, markerId: string, expectedUpdatedAt: string | null): TripMarkerNote | null {
    return getDb().transaction(() => {
        requireTargets(tripId, markerId)
        const row = getDb().prepare('SELECT markdown_content FROM markers WHERE id = ?').get(markerId) as { markdown_content: string }
        const existing = getTripMarkerNote(tripId, markerId)
        if (existing?.content.trim()) throw new TripMarkerNoteError('本次旅行已有笔记，请在编辑器中整理，避免覆盖', 409)
        return updateTripMarkerNote(tripId, markerId, { content: row.markdown_content, expectedUpdatedAt })
    }).immediate()
}
