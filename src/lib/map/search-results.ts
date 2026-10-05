import type { SearchResult } from '@/lib/api/search-service'
import type { Marker } from '@/types/marker'

export type MapSearchResult = SearchResult & { markerId?: string }

// Use the same six-decimal precision as saved marker coordinate identities.
function coordinateKey(coordinates: SearchResult['coordinates']): string {
    const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000
    return `${rounded(coordinates.longitude)},${rounded(coordinates.latitude)}`
}
function savedResult(marker: Marker): MapSearchResult {
    return { id: marker.id, markerId: marker.id, name: marker.content.title || '未命名地点',
        coordinates: marker.coordinates, address: marker.content.address }
}

/** Saved titles match globally; provider results retain the current viewport scope. */
export function mergeSearchResults(query: string, markers: Marker[], results: SearchResult[]): MapSearchResult[] {
    const keyword = query.trim().toLocaleLowerCase()
    if (!keyword) return []
    const savedByCoordinates = new Map<string, Marker>()
    for (const marker of markers) {
        const key = coordinateKey(marker.coordinates)
        if (!savedByCoordinates.has(key)) savedByCoordinates.set(key, marker)
    }
    const merged: MapSearchResult[] = markers.filter(marker => marker.content.title?.toLocaleLowerCase().includes(keyword)).map(savedResult)
    const seen = new Set(merged.map(result => `marker:${result.markerId}`))
    for (const result of results) {
        const { longitude, latitude } = result.coordinates || {}
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) continue
        const marker = savedByCoordinates.get(coordinateKey(result.coordinates))
        const item = marker ? savedResult(marker) : result
        const key = marker ? `marker:${marker.id}` : result.placeId || `${result.name}:${coordinateKey(result.coordinates)}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(item)
    }
    return merged
}
