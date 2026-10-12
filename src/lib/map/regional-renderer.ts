import { isInChina } from '@/lib/coord-transform'
import type { BasemapProviderType, MapCoordinates } from '@/types/map-provider'

// OSM remains an explicit deployment choice; SDK maps select by canonical WGS-84 center.
export function regionalRenderer(configured: BasemapProviderType, center: MapCoordinates): BasemapProviderType {
    if (configured === 'osm') return 'osm'
    return isInChina(center.longitude, center.latitude) ? 'amap' : 'google'
}
