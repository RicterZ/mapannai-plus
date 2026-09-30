import { MapProvider, MapProviderConfig, MapSearchResult, MapCoordinates, PlaceDetails, RoutePoint, MapRoute, TravelMode, MapSearchOptions } from '@/types/map-provider'
import { config } from '@/lib/config'
import { gcj02ToWgs84, wgs84ToGcj02, isInChina } from '@/lib/coord-transform'
import { decode } from '@googlemaps/polyline-codec'

export class GoogleServerProvider implements MapProvider {
    // 后端搜索功能 - 支持
    async searchPlaces(query: string, mapConfig: MapProviderConfig = { accessToken: config.map.google.accessToken }, country?: string, options?: MapSearchOptions): Promise<MapSearchResult[]> {
        try {
            const apiKey = mapConfig.accessToken
            if (!apiKey) {
                throw new Error('Google API Key 未配置')
            }

            // 构建搜索请求
            const baseUrl = `${config.map.google.baseUrl}/maps/api/place/textsearch/json`
            const params = new URLSearchParams({
                query,
                key: apiKey,
                language: 'zh-CN',
                region: country || 'CN'
            })
            if (options?.bounds) {
                const bounds = options.bounds
                const latitude = (bounds.south + bounds.north) / 2
                const longitude = (bounds.west + bounds.east) / 2
                const center = (country || 'CN').toUpperCase() === 'CN' ? wgs84ToGcj02(longitude, latitude) : { longitude, latitude }
                const radius = Math.min(50000, Math.max(500, Math.hypot((bounds.north - bounds.south) * 55500, (bounds.east - bounds.west) * 55500 * Math.cos(latitude * Math.PI / 180))))
                params.set('location', `${center.latitude},${center.longitude}`)
                params.set('radius', String(Math.round(radius)))
            }

            const response = await fetch(`${baseUrl}?${params}`)

            if (!response.ok) {
                throw new Error(`Google Places API 请求失败: ${response.status}`)
            }

            const data = await response.json()

            if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
                throw new Error(`Google Places API 错误: ${data.status} - ${data.error_message || 'Unknown error'}`)
            }

            // 转换结果格式，中国境内坐标从 GCJ-02 转为 WGS-84
            const isChina = (country || 'CN').toUpperCase() === 'CN'
            return (data.results || []).map((place: any) => {
                const gcjLng = place.geometry.location.lng
                const gcjLat = place.geometry.location.lat
                const coords = isChina ? gcj02ToWgs84(gcjLng, gcjLat) : { longitude: gcjLng, latitude: gcjLat }
                return {
                    name: place.name,
                    coordinates: {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                    },
                    address: place.formatted_address,
                    placeId: place.place_id,
                    rating: place.rating,
                    types: place.types,
                }
            })
        } catch (error) {
            console.error('Google Places 搜索失败:', error)
            throw error
        }
    }
    async getPlaceDetails({ latitude, longitude }: MapCoordinates): Promise<PlaceDetails> {
        const isChina = isInChina(longitude, latitude)
        const apiKey = config.map.google.accessToken
        if (!apiKey) throw new Error('Google API Key 未配置')

        // 中国境内需将 WGS-84 转为 GCJ-02 再查，否则地点名会偏移
        const queryCoords = isChina
            ? wgs84ToGcj02(longitude, latitude)
            : { longitude, latitude }

        // 第一步：使用 Reverse Geocoding API 获取地点信息
        const reverseGeocodeUrl = `${config.map.google.baseUrl}/maps/api/geocode/json`
        const reverseGeocodeParams = new URLSearchParams({
            latlng: `${queryCoords.latitude},${queryCoords.longitude}`,
            key: apiKey,
            language: 'zh-CN'
        })

        const reverseGeocodeResponse = await fetch(`${reverseGeocodeUrl}?${reverseGeocodeParams}`)

        if (!reverseGeocodeResponse.ok) {
            throw new Error(`Google Reverse Geocoding API 请求失败: ${reverseGeocodeResponse.status}`)
        }

        const reverseGeocodeData = await reverseGeocodeResponse.json()

        if (reverseGeocodeData.status !== 'OK') {
            throw new Error(`Google Reverse Geocoding API 错误: ${reverseGeocodeData.status} - ${reverseGeocodeData.error_message || 'Unknown error'}`)
        }

        // 获取第一个结果
        const firstResult = reverseGeocodeData.results?.[0]
        if (!firstResult) {
            return { name: '未知地点', address: '无法获取地址信息', coordinates: { latitude, longitude } }
        }

        // 提取基本信息
        const address = firstResult.formatted_address || '未知地址'
        const placeId = firstResult.place_id

        // 第二步：如果有 placeId，获取详细信息
        let detailedInfo = null
        if (placeId) {
            try {
                const placeDetailsUrl = `${config.map.google.baseUrl}/maps/api/place/details/json`
                const placeDetailsParams = new URLSearchParams({
                    place_id: placeId,
                    key: apiKey,
                    language: 'zh-CN',
                    fields: 'name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,price_level,opening_hours,types'
                })

                const placeDetailsResponse = await fetch(`${placeDetailsUrl}?${placeDetailsParams}`)

                if (placeDetailsResponse.ok) {
                    const placeDetailsData = await placeDetailsResponse.json()

                    if (placeDetailsData.status === 'OK' && placeDetailsData.result) {
                        const result = placeDetailsData.result
                        detailedInfo = {
                            name: result.name || address,
                            address: result.formatted_address || address,
                            phone: result.formatted_phone_number,
                            website: result.website,
                            rating: result.rating,
                            user_ratings_total: result.user_ratings_total,
                            price_level: result.price_level,
                            opening_hours: result.opening_hours,
                            types: result.types
                        }
                    }
                }
            } catch (error) {
                console.warn('获取地点详细信息失败:', error)
                // 即使详细信息获取失败，也返回基本信息
            }
        }

        // 返回结果
        const result = {
            name: detailedInfo?.name || firstResult.formatted_address || '未知地点',
            address: detailedInfo?.address || address,
            placeId: placeId,
            coordinates: { latitude, longitude },
            phone: detailedInfo?.phone,
            website: detailedInfo?.website,
            rating: detailedInfo?.rating,
            user_ratings_total: detailedInfo?.user_ratings_total,
            price_level: detailedInfo?.price_level,
            opening_hours: detailedInfo?.opening_hours,
            types: detailedInfo?.types || firstResult.types
        }

        return result
    }
    async getDirections(origin: RoutePoint, destination: RoutePoint, mode: TravelMode = 'walking'): Promise<MapRoute> {
        const apiKey = config.map.google.accessToken
        if (!apiKey) throw new Error('Google API Key 未配置')
        const from = wgs84ToGcj02(origin.lng, origin.lat)
        const to = wgs84ToGcj02(destination.lng, destination.lat)
        // 构建 Google Directions API 请求
        const baseUrl = `${config.map.google.baseUrl}/maps/api/directions/json`
        const params = new URLSearchParams({
            origin: `${from.latitude},${from.longitude}`,
            destination: `${to.latitude},${to.longitude}`,
            mode: mode,
            key: apiKey
        })

        const response = await fetch(`${baseUrl}?${params}`)

        if (!response.ok) {
            throw new Error(`Google Directions API 请求失败: ${response.status}`)
        }

        const data = await response.json()

        if (data.status !== 'OK') {
            throw new Error(`Google Directions API 错误: ${data.status} - ${data.error_message || 'Unknown error'}`)
        }

        // 检查响应数据结构
        if (!data.routes || !Array.isArray(data.routes) || data.routes.length === 0) {
            throw new Error('Google Directions API 返回的路径数据为空')
        }

        // 提取路径数据
        const route = data.routes[0]
        if (!route.legs || !Array.isArray(route.legs) || route.legs.length === 0) {
            throw new Error('Google Directions API 返回的路径段数据为空')
        }

        const leg = route.legs[0]

        const path: Array<{ lat: number; lng: number }> = []
        const overviewPath = route.overview_path

        // 检查 overview_path 是否存在
        if (overviewPath && Array.isArray(overviewPath)) {
            overviewPath.forEach((point: any) => {
                path.push({
                    lat: point.lat,
                    lng: point.lng
                })
            })
        } else {
            // 如果没有 overview_path，尝试从 steps 中提取路径
            if (leg.steps && Array.isArray(leg.steps)) {
                leg.steps.forEach((step: any) => {
                    if (step.polyline && step.polyline.points) {
                        try {
                            // 解码 polyline 获取详细路径点
                            const decodedPath = decode(step.polyline.points)
                            decodedPath.forEach((point: [number, number]) => {
                                path.push({
                                    lat: point[0],
                                    lng: point[1]
                                })
                            })
                        } catch (error) {
                            console.warn('Polyline 解码失败:', error)
                        }
                    }
                })
            }

            // 如果仍然没有路径点，至少返回起点和终点
            if (path.length === 0) {
                path.push({
                    lat: leg.start_location.lat,
                    lng: leg.start_location.lng
                })
                path.push({
                    lat: leg.end_location.lat,
                    lng: leg.end_location.lng
                })
            }
        }

        return {
            path: path.map(p => { const c = gcj02ToWgs84(p.lng, p.lat); return { lat: c.latitude, lng: c.longitude } }),
            distance: leg.distance?.value || 0,
            duration: leg.duration?.value || 0
        }
    }
}
