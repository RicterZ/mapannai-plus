import type { MapProviderFactory, MapProviderType, MapProvider, MapServiceCapability } from '@/types/map-provider'
import { GoogleServerProvider } from './google-server-provider'
import { AmapServerProvider } from './amap-server-provider'
import { isInChina } from '@/lib/coord-transform'
import type { MapCoordinates, MapProviderConfig, MapSearchOptions, MapSearchPage, PlaceDetails, RoutePoint, TravelMode } from '@/types/map-provider'

export function parseServiceProvider(value: string): MapProviderType {
    if (value !== 'google' && value !== 'amap') throw new Error(`Unsupported map service provider: ${value}`)
    return value
}
export class MapProviderFactoryImpl implements MapProviderFactory {
    createProvider(type: MapProviderType): MapProvider {
        switch (type) {
            case 'google': return new GoogleServerProvider()
            case 'amap': return new AmapServerProvider()
            default: throw new Error(`Unsupported map service provider: ${type}`)
        }
    }
    createServiceProvider(capability: MapServiceCapability, override?: string | null): MapProvider {
        return override ? this.createProvider(parseServiceProvider(override)) : new RegionalServerProvider(this)
    }
    getSupportedProviders(): MapProviderType[] { return ['google', 'amap'] }
}
export const mapProviderFactory = new MapProviderFactoryImpl()

export function searchServiceProvider(country?: string, options?: MapSearchOptions): MapProviderType {
    if (options?.pageToken) return 'google'
    if (options?.bounds) {
        const { west, east, south, north } = options.bounds
        return isInChina((west + east) / 2, (south + north) / 2) ? 'amap' : 'google'
    }
    return (country || 'CN').toUpperCase() === 'CN' ? 'amap' : 'google'
}

class RegionalServerProvider implements MapProvider {
    constructor(private factory: MapProviderFactoryImpl) {}
    async searchPlacesPage(query: string, config?: MapProviderConfig, country?: string, options?: MapSearchOptions): Promise<MapSearchPage> {
        const provider = searchServiceProvider(country, options)
        if (provider === 'google') return this.factory.createProvider('google').searchPlacesPage(query, config, country, options)
        try {
            const result = await this.factory.createProvider('amap').searchPlacesPage(query, config, 'CN', options)
            if (result.results.length || (options?.page ?? 1) > 1) return result
        } catch (error) {
            if (options?.signal?.aborted || (options?.page ?? 1) > 1) throw error
        }
        // Only the first page may switch services; later pages keep the original cursor.
        return this.factory.createProvider('google').searchPlacesPage(query, undefined, country, options)
    }
    async searchPlaces(query: string, config?: MapProviderConfig, country?: string, options?: MapSearchOptions) {
        return (await this.searchPlacesPage(query, config, country, options)).results
    }
    async getPlaceDetails(coords: MapCoordinates): Promise<PlaceDetails> {
        if (isInChina(coords.longitude, coords.latitude)) {
            try {
                const result = await this.factory.createProvider('amap').getPlaceDetails(coords)
                if ((result.name.trim() && result.name !== '未知地点') || result.address?.trim()) return result
            } catch { /* Try Google when AMap cannot supply useful place information. */ }
        }
        return this.factory.createProvider('google').getPlaceDetails(coords)
    }
    async getDirections(origin: RoutePoint, destination: RoutePoint, mode?: TravelMode) {
        const { getSavedDirection } = await import('../direction-service')
        return getSavedDirection(origin, destination, mode)
    }
}
