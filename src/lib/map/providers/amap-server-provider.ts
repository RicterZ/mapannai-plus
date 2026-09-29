import { config } from '@/lib/config'
import { gcj02ToWgs84, wgs84ToGcj02, isInChina } from '@/lib/coord-transform'
import type { MapProvider, MapProviderConfig, MapSearchResult, MapCoordinates, PlaceDetails, RoutePoint, MapRoute, TravelMode } from '@/types/map-provider'

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
        placeId: text(poi.id), types: text(poi.type).split(';').filter(Boolean),
    }
}
export class AmapServerProvider implements MapProvider {
    private async request(path: string, params: Record<string, string>, key = config.map.amap.accessToken): Promise<any> {
        if (!key) throw new Error('高德 Web 服务 Key 未配置（AMAP_API_KEY）')
        const response = await fetch(`${config.map.amap.baseUrl}${path}?${new URLSearchParams({ ...params, key, output: 'JSON' })}`)
        if (!response.ok) throw new Error(`高德请求失败: ${response.status}`)
        const data = await response.json()
        if (data.status !== '1') throw new Error(`高德 API 错误: ${data.info || data.infocode}`)
        return data
    }
    async searchPlaces(query: string, mapConfig?: MapProviderConfig, country = 'CN'): Promise<MapSearchResult[]> {
        if (country.toUpperCase() !== 'CN') throw new Error('高德地点搜索仅支持中国，请选择 Google 搜索后端')
        const data = await this.request('/v3/place/text', { keywords: query, extensions: 'all', offset: '20', page: '1' }, mapConfig?.accessToken)
        return (data.pois || []).filter((p: any) => typeof p.location === 'string' && p.location).map(poiResult)
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
