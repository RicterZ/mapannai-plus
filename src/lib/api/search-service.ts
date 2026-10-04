import type { PlaceReferences } from '@/types/place-references'
// 搜索服务 - 统一使用 /api/search 端点
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import type { MapSearchOptions } from '@/types/map-provider'

export interface SearchResult {
    placeReferences?: PlaceReferences
    id: string
    name: string
    coordinates: {
        longitude: number
        latitude: number
    }
    address?: string
    placeId?: string
    rating?: number
    types?: string[]
    properties?: any
    bbox?: number[]
}

export interface SearchService {
    searchPlaces(query: string, limit?: number, language?: string, country?: string, options?: MapSearchOptions): Promise<SearchResult[]>
}

export class MapSearchService implements SearchService {
    constructor() {
        // 不再需要地图提供者配置
    }

    async searchPlaces(query: string, limit: number = 5, language: string = 'zh-CN', country?: string, options?: MapSearchOptions): Promise<SearchResult[]> {
        try {
            // 直接调用 /api/search 端点
            const params = new URLSearchParams({
                q: query,
                limit: limit.toString(),
                language: language,
                country: country || 'CN'
            })
            if (options?.bounds) params.set('bounds', JSON.stringify(options.bounds))
            
            const url = `/api/search?${params}`

            const response = await fetchWithAuth(url, {
                method: 'GET',
                signal: options?.signal,
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}))
                throw new Error(error.details || error.error || `搜索 API 错误: ${response.status}`)
            }
            
            const result = await response.json()
            
            if (!result.success) {
                throw new Error(result.error || '搜索失败')
            }
            
            return result.data || []
        } catch (error) {
            console.error('搜索服务错误:', error)
            throw error
        }
    }
}

// 单例实例
export const searchService = new MapSearchService()
