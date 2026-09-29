import type { BasemapProviderType, MapProviderType } from '@/types/map-provider'

export interface MapPreferences {
    basemap: BasemapProviderType
    search: MapProviderType
    details: MapProviderType
    directions: MapProviderType
}
export const defaultMapPreferences: MapPreferences = {
    basemap: process.env.NEXT_PUBLIC_MAP_BASEMAP === 'amap' ? 'amap' : 'osm',
    search: process.env.NEXT_PUBLIC_MAP_SEARCH_PROVIDER === 'amap' ? 'amap' : 'google',
    details: process.env.NEXT_PUBLIC_MAP_DETAILS_PROVIDER === 'amap' ? 'amap' : 'google',
    directions: process.env.NEXT_PUBLIC_MAP_DIRECTIONS_PROVIDER === 'amap' ? 'amap' : 'google',
}
const storageKey = 'mapannai-map-providers'
export function getMapPreferences(): MapPreferences {
    if (typeof window === 'undefined') return defaultMapPreferences
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
        return {
            basemap: ['osm', 'amap'].includes(saved.basemap) ? saved.basemap : defaultMapPreferences.basemap,
            search: ['google', 'amap'].includes(saved.search) ? saved.search : defaultMapPreferences.search,
            details: ['google', 'amap'].includes(saved.details) ? saved.details : defaultMapPreferences.details,
            directions: ['google', 'amap'].includes(saved.directions) ? saved.directions : defaultMapPreferences.directions,
        }
    } catch { return defaultMapPreferences }
}
export function saveMapPreferences(preferences: MapPreferences): void {
    localStorage.setItem(storageKey, JSON.stringify(preferences))
    window.dispatchEvent(new Event('mapannai:providers-changed'))
}
