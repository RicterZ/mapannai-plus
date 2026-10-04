import { parsePlaceReferences, mergePlaceReferences, PlaceReferencesValidationError } from '@/lib/places/place-references'
import { projectChains, removeRouteMarker } from '@/lib/trips/route-chain'
import type { RouteChain } from '@/types/trip'
/**
 * Marker Service — SQLite-backed marker storage
 *
 * Replaces the former Mapbox Dataset dependency. All markers are stored
 * locally in the `markers` table and returned as GeoJSON Features to keep
 * the rest of the codebase compatible with the previous datasetService API.
 */

import crypto from 'crypto'
import { getDb } from './index'
import { calculateDistance } from '@/utils/distance'

// ── Types ──────────────────────────────────────────────────────────────────

export interface GeoJSONFeature {
    type: 'Feature'
    id: string
    geometry: {
        type: 'Point'
        coordinates: [number, number] // [longitude, latitude]
    }
    properties: Record<string, any>
}

export interface GeoJSONFeatureCollection {
    type: 'FeatureCollection'
    features: GeoJSONFeature[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic coordinate hash.
 * Coordinates are rounded to 6 decimal places (~0.1m precision) before hashing.
 */
export function generateCoordinateHash(longitude: number, latitude: number): string {
    const lng = Math.round(longitude * 1_000_000) / 1_000_000
    const lat = Math.round(latitude * 1_000_000) / 1_000_000
    return crypto.createHash('md5').update(`${lat},${lng}`).digest('hex')
}

function rowToFeature(row: any): GeoJSONFeature {
    return {
        type: 'Feature',
        id: row.id,
        geometry: {
            type: 'Point',
            coordinates: [row.longitude, row.latitude],
        },
        properties: {
            placeReferences: row.place_references ? mergePlaceReferences(null, parsePlaceReferences(JSON.parse(row.place_references))) : null,
            iconType: row.icon_type,
            markdownContent: row.markdown_content,
            headerImage: row.header_image ?? null,
            address: row.address ?? null,
            metadata: {
                id: row.id,
                title: row.title ?? '未命名标记',
                description: row.description ?? null,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                isPublished: true,
                coordinateHash: generateCoordinateHash(row.longitude, row.latitude),
            },
        },
    }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Return all markers as a GeoJSON FeatureCollection. */
export function getAllMarkers(): GeoJSONFeatureCollection {
    const rows = getDb()
        .prepare(`SELECT * FROM markers ORDER BY created_at DESC`)
        .all() as any[]
    return {
        type: 'FeatureCollection',
        features: rows.map(rowToFeature),
    }
}

/** Return a single marker by ID, or null if not found. */
export function getMarkerById(id: string): GeoJSONFeature | null {
    const row = getDb()
        .prepare(`SELECT * FROM markers WHERE id = ?`)
        .get(id) as any
    return row ? rowToFeature(row) : null
}

/**
 * Find the nearest marker within radiusMeters (default 10 m).
 * Used for deduplication: same place should not be stored twice.
 */
export function findNearbyMarker(
    longitude: number,
    latitude: number,
    radiusMeters = 10
): GeoJSONFeature | null {
    const rows = getDb()
        .prepare(`SELECT * FROM markers`)
        .all() as any[]

    for (const row of rows) {
        const dist = calculateDistance(latitude, longitude, row.latitude, row.longitude)
        if (dist <= radiusMeters) {
            return rowToFeature(row)
        }
    }
    return null
}

/**
 * Insert or update a marker.
 *
 * @param id         Marker ID (e.g. `coord_<hash>`)
 * @param longitude  WGS-84 longitude
 * @param latitude   WGS-84 latitude
 * @param properties Flat properties object (mirrors the former Mapbox feature properties)
 */
export function upsertMarker(
    id: string,
    longitude: number,
    latitude: number,
    properties: Record<string, any>
): GeoJSONFeature {
    const patch = properties.placeReferences === undefined ? undefined : parsePlaceReferences(properties.placeReferences)
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw new PlaceReferencesValidationError('需要有效 WGS-84 坐标')
    const now = new Date().toISOString()
    const meta = properties.metadata || {}

    const db = getDb()
    return db.transaction(() => {
        const existing = getMarkerById(id)
        const moved = existing && generateCoordinateHash(...existing.geometry.coordinates) !== generateCoordinateHash(longitude, latitude)
        const references = mergePlaceReferences(moved ? null : existing?.properties.placeReferences ?? null, patch)
        db.prepare(`
            INSERT INTO markers
                (id, longitude, latitude, title, address, header_image, icon_type, markdown_content, description, created_at, updated_at, place_references)
            VALUES
                (@id, @longitude, @latitude, @title, @address, @headerImage, @iconType, @markdownContent, @description, @createdAt, @updatedAt, @placeReferences)
            ON CONFLICT(id) DO UPDATE SET
                place_references = excluded.place_references,
                longitude        = excluded.longitude,
                latitude         = excluded.latitude,
                title            = excluded.title,
                address          = excluded.address,
                header_image     = excluded.header_image,
                icon_type        = excluded.icon_type,
                markdown_content = excluded.markdown_content,
                description      = excluded.description,
                updated_at       = excluded.updated_at
        `).run({
            placeReferences: references ? JSON.stringify(references) : null,
            id,
            longitude,
            latitude,
            title: meta.title ?? properties.title ?? null,
            address: properties.address ?? null,
            headerImage: properties.headerImage ?? null,
            iconType: properties.iconType ?? 'location',
            markdownContent: properties.markdownContent ?? '',
            description: meta.description ?? properties.description ?? null,
            createdAt: meta.createdAt ?? now,
            updatedAt: meta.updatedAt ?? now,
        })

        return getMarkerById(id)!
    }).immediate()
}

/** Delete a marker by ID. No-op if it doesn't exist. */
export function deleteMarker(id: string): void {
    const db = getDb()
    db.transaction(() => {
        db.prepare(`DELETE FROM markers WHERE id = ?`).run(id)
        const trips = db.prepare('SELECT id, marker_ids FROM trips').all() as { id: string; marker_ids: string }[]
        for (const trip of trips) {
            const ids: string[] = JSON.parse(trip.marker_ids)
            if (ids.includes(id)) db.prepare('UPDATE trips SET marker_ids = ? WHERE id = ?').run(JSON.stringify(ids.filter(markerId => markerId !== id)), trip.id)
        }
        const days = db.prepare('SELECT id, marker_ids, chains, route_chains FROM trip_days').all() as { id: string; marker_ids: string; chains: string; route_chains: string }[]
        const update = db.prepare('UPDATE trip_days SET marker_ids = ?, chains = ?, route_chains = ? WHERE id = ?')
        for (const day of days) {
            const markerIds: string[] = JSON.parse(day.marker_ids)
            const chains: string[][] = JSON.parse(day.chains)
            if (!markerIds.includes(id) && !chains.some(chain => chain.includes(id))) continue
            const routes = removeRouteMarker(JSON.parse(day.route_chains) as RouteChain[], id)
            update.run(JSON.stringify(markerIds.filter(markerId => markerId !== id)), JSON.stringify(projectChains(routes)), JSON.stringify(routes), day.id)
        }
    })()
}

/** Patch editable fields and resolve current coordinates inside the write transaction. */
export function updateMarkerFields(id: string, body: Record<string, any>): GeoJSONFeature | null {
    // Validate before any write, including when the marker is missing.
    const patch = body.placeReferences === undefined ? undefined : parsePlaceReferences(body.placeReferences)
    return getDb().transaction(() => {
        const feature = getMarkerById(id)
        if (!feature) return null
        const properties = { ...feature.properties }
        delete properties.placeReferences // Stored state is not an explicit patch from the caller.
        if (patch !== undefined) properties.placeReferences = patch
        for (const field of ['address', 'headerImage', 'markdownContent', 'iconType']) {
            if (body[field] !== undefined) properties[field] = body[field]
        }
        properties.metadata = { ...properties.metadata, updatedAt: new Date().toISOString() }
        if (body.title !== undefined) properties.metadata.title = body.title
        const coords = body.coordinates === undefined ? {
            longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1],
        } : body.coordinates
        return upsertMarker(id, coords?.longitude, coords?.latitude, properties)
    }).immediate()
}

/** Public Marker shape, shared by all CRUD endpoints. */
export function featureToMarker(feature: GeoJSONFeature) {
    const props = feature.properties
    const meta = props.metadata || {}
    return {
        id: feature.id,
        coordinates: { longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] },
        placeReferences: props.placeReferences ?? null,
        content: {
            id: feature.id, title: meta.title || '未命名标记', address: props.address || undefined,
            headerImage: props.headerImage || undefined, iconType: props.iconType,
            markdownContent: props.markdownContent || '', next: props.next || [],
            createdAt: meta.createdAt, updatedAt: meta.updatedAt,
        },
    }
}
