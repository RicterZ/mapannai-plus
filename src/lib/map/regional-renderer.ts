import { isInChina } from '@/lib/coord-transform'
import type { BasemapProviderType, MapCoordinates } from '@/types/map-provider'
import { toMapCoordinates, fromMapCoordinates } from './basemap'

/** SDK cameras use 256px tiles; evaluate the unobscured screen center, not bounds. */
export function visibleMapCenter(camera: MapCoordinates & { zoom: number }, renderer: BasemapProviderType, offset: [number, number]): MapCoordinates {
    const point = toMapCoordinates(camera, renderer)
    const size = (renderer === 'osm' ? 512 : 256) * 2 ** camera.zoom
    const lat = Math.max(-85, Math.min(85, point.latitude)) * Math.PI / 180
    const y = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 + offset[1] / size
    const longitude = ((point.longitude + offset[0] * 360 / size + 180) % 360 + 360) % 360 - 180
    return fromMapCoordinates({ longitude, latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI }, renderer)
}

// OSM remains an explicit deployment choice; SDK maps select by canonical WGS-84 center.
export function regionalRenderer(configured: BasemapProviderType, center: MapCoordinates): BasemapProviderType {
    if (configured === 'osm') return 'osm'
    return isInChina(center.longitude, center.latitude) ? 'amap' : 'google'
}
