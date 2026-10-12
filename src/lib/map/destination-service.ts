import { config } from '@/lib/config'
import { gcj02ToWgs84, isInChina } from '@/lib/coord-transform'
import { tripDestinationSchema } from '@/lib/trips/destination'
import type { TripDestination } from '@/types/trip'

/** Search administrative places without the current map's bounds or a country restriction. */
export async function searchDestinations(query: string, signal?: AbortSignal): Promise<TripDestination[]> {
    if (config.map.amap.accessToken) {
        try {
            const params = new URLSearchParams({ address: query, key: config.map.amap.accessToken, output: 'JSON' })
            const response = await fetch(`${config.map.amap.baseUrl}/v3/geocode/geo?${params}`, { signal })
            const data = await response.json()
            if (response.ok && data.status === '1') {
                const results: TripDestination[] = []
                for (const place of data.geocodes || []) {
                    if (!['省', '市', '区县'].includes(place.level) || typeof place.location !== 'string') continue
                    const [lng, lat] = place.location.split(',').map(Number)
                    if (!isInChina(lng, lat)) continue
                    const result = tripDestinationSchema.safeParse({ name: place.formatted_address, ...gcj02ToWgs84(lng, lat) })
                    if (result.success) results.push(result.data)
                }
                if (results.length) return results.slice(0, 5)
            }
        } catch (error) { if (signal?.aborted) throw error }
    }
    signal?.throwIfAborted()
    if (!config.map.google.accessToken) throw new Error('目的地搜索需要配置 Google API Key')
    const params = new URLSearchParams({ address: query, key: config.map.google.accessToken, language: 'zh-CN' })
    const response = await fetch(`${config.map.google.baseUrl}/maps/api/geocode/json?${params}`, { signal })
    const data = await response.json()
    if (!response.ok || !['OK', 'ZERO_RESULTS'].includes(data.status)) throw new Error('目的地搜索失败，请稍后重试')
    const results: TripDestination[] = []
    for (const place of data.results || []) {
        if (!place.types?.some((type: string) => ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3'].includes(type))) continue
        const location = place.geometry?.location
        if (!location) continue
        const coords = gcj02ToWgs84(location.lng, location.lat)
        const result = tripDestinationSchema.safeParse({ name: place.formatted_address, ...coords })
        if (result.success) results.push(result.data)
    }
    return results.slice(0, 5)
}
