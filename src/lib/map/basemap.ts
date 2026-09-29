import type { StyleSpecification } from 'maplibre-gl'
import type { BasemapProviderType, MapCoordinates } from '@/types/map-provider'
import { gcj02ToWgs84, wgs84ToGcj02 } from '@/lib/coord-transform'

export function toMapCoordinates(c: MapCoordinates, basemap: BasemapProviderType): MapCoordinates {
    return basemap === 'amap' ? wgs84ToGcj02(c.longitude, c.latitude) : c
}
export function fromMapCoordinates(c: MapCoordinates, basemap: BasemapProviderType): MapCoordinates {
    return basemap === 'amap' ? gcj02ToWgs84(c.longitude, c.latitude) : c
}
export function createBasemapStyle(basemap: BasemapProviderType, origin: string): StyleSpecification {
    const amap = basemap === 'amap'
    const tiles = amap
        ? [`${origin}/amap-tiles/{z}/{x}/{y}`]
        : [process.env.NEXT_PUBLIC_OSM_TILE_PROXY !== 'false' ? `${origin}/osm-tiles/{z}/{x}/{y}.png` : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png']
    return {
        version: 8, name: basemap,
        sources: { basemap: { type: 'raster', tiles, tileSize: 256, minzoom: 0, maxzoom: amap ? 18 : 19, attribution: amap ? '© 高德地图' : '© OpenStreetMap contributors' } },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
    }
}
