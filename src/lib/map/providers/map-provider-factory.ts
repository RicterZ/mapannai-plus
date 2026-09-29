import type { MapProviderFactory, MapProviderType, MapProvider, MapServiceCapability } from '@/types/map-provider'
import { GoogleServerProvider } from './google-server-provider'
import { AmapServerProvider } from './amap-server-provider'

export function parseServiceProvider(value: string): MapProviderType {
    if (value !== 'google' && value !== 'amap') throw new Error(`Unsupported map service provider: ${value}`)
    return value
}
export function defaultServiceProvider(capability: MapServiceCapability): MapProviderType {
    const values = { search: process.env.MAP_SEARCH_PROVIDER, details: process.env.MAP_DETAILS_PROVIDER, directions: process.env.MAP_DIRECTIONS_PROVIDER }
    return parseServiceProvider(values[capability] || 'google')
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
        return this.createProvider(override ? parseServiceProvider(override) : defaultServiceProvider(capability))
    }
    getSupportedProviders(): MapProviderType[] { return ['google', 'amap'] }
}
export const mapProviderFactory = new MapProviderFactoryImpl()
