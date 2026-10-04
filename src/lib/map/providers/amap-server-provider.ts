import { officialPlaceReferences } from '@/lib/places/place-references'
import { config } from '@/lib/config'
import { gcj02ToWgs84, wgs84ToGcj02, isInChina } from '@/lib/coord-transform'
import type { MapProvider, MapProviderConfig, MapSearchResult, MapCoordinates, PlaceDetails, RoutePoint, MapRoute, TravelMode, MapSearchOptions, MapSearchPage } from '@/types/map-provider'

function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function coordinates(location: string): MapCoordinates {
    const [lng, lat] = location.split(',').map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('高德返回无效坐标')
    return gcj02ToWgs84(lng, lat)
}
function poiResult(poi: any): MapSearchResult {
    return {
        name: text(poi.name), coordinates: coordinates(poi.location),
        address: [text(poi.pname), text(poi.cityname), text(poi.adname), text(poi.address)].filter(Boolean).join(' '),
        placeReferences: officialPlaceReferences('amap', poi.id),
        placeId: text(poi.id), types: text(poi.type).split(';').filter(Boolean),
    }
}
export class AmapServerProvider implements MapProvider {
    private async request(path: string, params: Record<string, string>, key = config.map.amap.accessToken, signal?: AbortSignal): Promise<any> {
        if (!key) throw new Error('高德 Web 服务 Key 未配置（AMAP_API_KEY）')
        const response = await fetch(`${config.map.amap.baseUrl}${path}?${new URLSearchParams({ ...params, key, output: 'JSON' })}`, { signal })
        if (!response.ok) throw new Error(`高德请求失败: ${response.status}`)
        const data = await response.json()
        if (data.status !== '1') throw new Error(`高德 API 错误: ${data.info || data.infocode}`)
        return data
    }
    async searchPlaces(query: string, mapConfig?: MapProviderConfig, country = 'CN', options?: MapSearchOptions): Promise<MapSearchResult[]> {
        return (await this.searchPlacesPage(query, mapConfig, country, options)).results
    }
    async searchPlacesPage(query: string, mapConfig?: MapProviderConfig, country = 'CN', options?: MapSearchOptions): Promise<MapSearchPage> {
        if (country.toUpperCase() !== 'CN') throw new Error('高德地点搜索仅支持中国，请选择 Google 搜索后端')
        const page = Math.max(1, Math.min(100, Math.trunc(options?.page ?? 1)))
        const pageSize = Math.max(1, Math.min(25, Math.trunc(options?.pageSize ?? 20)))
        const params: Record<string, string> = { keywords: query, extensions: 'all', offset: String(pageSize), page: String(page) }
        let endpoint = '/v3/place/text'
        if (options?.bounds) {
            const bounds = options.bounds
            const sw = wgs84ToGcj02(bounds.west, bounds.south), ne = wgs84ToGcj02(bounds.east, bounds.north)
            params.polygon = `${sw.longitude},${sw.latitude}|${ne.longitude},${ne.latitude}`
            endpoint = '/v3/place/polygon'
            // Category names often do not occur in POI names (e.g. 呼和浩特东站).
            const categories: Record<string, string> = { 酒店: '100000', 宾馆: '100000', 住宿: '100000', 高铁站: '150200', 火车站: '150200', 铁路车站: '150200' }
            const category = categories[query.trim()]
            if (category) { params.types = category; delete params.keywords }
        }
        const data = await this.request(endpoint, params, mapConfig?.accessToken, options?.signal)
        const pois = Array.isArray(data.pois) ? data.pois : []
        const results = pois.filter((p: any) => typeof p.location === 'string' && p.location).map(poiResult)
        const parsedCount = Number(data.count)
        const total = data.count !== undefined && Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : undefined
        // Upstream count counts unfiltered POIs; don't stop because a coordinate was invalid.
        const hasMore = page < 100 && pois.length > 0 && (total !== undefined ? page * pageSize < total : pois.length === pageSize)
        return { results, page, pageSize, total, hasMore, nextPage: hasMore ? page + 1 : null }
    }
    async getPlaceDetails(coords: MapCoordinates): Promise<PlaceDetails> {
        if (!isInChina(coords.longitude, coords.latitude)) throw new Error('高德地点详情仅支持中国，请选择 Google 地点详情后端')
        const c = wgs84ToGcj02(coords.longitude, coords.latitude)
        const data = await this.request('/v3/geocode/regeo', { location: `${c.longitude},${c.latitude}`, extensions: 'all', radius: '100', roadlevel: '0' })
        const regeo = data.regeocode
        if (!regeo) throw new Error('高德返回的地点信息为空')
        const nearby = regeo.pois?.[0]
        let detail = null
        if (nearby?.id) {
            try { detail = (await this.request('/v3/place/detail', { id: nearby.id, extensions: 'all' })).pois?.[0] }
            catch { /* 逆地理编码结果仍可用于基本地点信息 */ }
        }
        const poi = detail || nearby
        return {
            name: text(poi?.name) || text(regeo.formatted_address) || '未知地点',
            address: text(regeo.formatted_address), coordinates: coords,
            placeReferences: officialPlaceReferences('amap', poi?.id),
            placeId: text(poi?.id), phone: text(poi?.tel) || undefined,
            types: text(poi?.type).split(';').filter(Boolean),
            opening_hours: text(poi?.business?.opentime) || text(poi?.biz_ext?.open_time) || undefined,
        }
    }
    async getDirections(origin: RoutePoint, destination: RoutePoint, mode: TravelMode = 'walking'): Promise<MapRoute> {
        if (!isInChina(origin.lng, origin.lat) || !isInChina(destination.lng, destination.lat)) throw new Error('高德路线规划仅支持中国，请选择 Google 路线后端')
        if (mode !== 'walking' && mode !== 'driving') throw new Error('高德当前支持步行或驾车路线')
        const from = wgs84ToGcj02(origin.lng, origin.lat)
        const to = wgs84ToGcj02(destination.lng, destination.lat)
        const data = await this.request(`/v3/direction/${mode}`, { origin: `${from.longitude},${from.latitude}`, destination: `${to.longitude},${to.latitude}` })
        const route = data.route?.paths?.[0]
        if (!route) throw new Error('高德返回的路径数据为空')
        const path: RoutePoint[] = (route.steps || []).flatMap((step: any) => text(step.polyline).split(';').filter(Boolean).map(location => {
            const c = coordinates(location)
            return { lat: c.latitude, lng: c.longitude }
        }))
        if (path.length === 0) path.push(origin, destination)
        return { path, distance: Number(route.distance) || 0, duration: Number(route.duration) || 0 }
    }
}
