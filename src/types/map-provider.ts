import type { PlaceReferences } from './place-references'
// 通用地图接口定义
export interface MapCoordinates {
    latitude: number
    longitude: number
}

export interface MapViewState {
    longitude: number
    latitude: number
    zoom: number
    bearing?: number
    pitch?: number
    padding?: {
        top: number
        bottom: number
        left: number
        right: number
    }
}

export interface MapMarker {
    id: string
    coordinates: MapCoordinates
    // 其他标记属性可以根据需要扩展
}

export interface MapSearchResult {
    placeReferences?: PlaceReferences
    name: string
    coordinates: MapCoordinates
    address?: string
    placeId?: string
    rating?: number
    types?: string[]
}

export interface MapSearchBounds { west: number; south: number; east: number; north: number }
export interface MapSearchOptions {
    bounds?: MapSearchBounds
    signal?: AbortSignal
    page?: number
    pageSize?: number
    pageToken?: string
}

export interface MapSearchPage {
    results: MapSearchResult[]
    page: number
    pageSize: number
    hasMore: boolean
    nextPage: number | null
    nextPageToken?: string
    total?: number
}

// 详细的地点信息接口
export interface DetailedPlaceInfo {
    name: string
    address: string
    placeId: string
    phone?: string
    website?: string
    rating?: number
    user_ratings_total?: number
    price_level?: number
    opening_hours?: any
}

export interface MapProviderConfig {
    accessToken: string
    style?: string
    // 其他配置项
}

// 地图底图与后端能力分别选择；所有服务输入输出均为 WGS-84。
export type BasemapProviderType = 'osm' | 'amap'
export type MapProviderType = 'google' | 'amap'
export type MapServiceCapability = 'search' | 'details' | 'directions'
export interface PlaceDetails extends MapSearchResult {
    phone?: string
    website?: string
    user_ratings_total?: number
    price_level?: number
    opening_hours?: unknown
}
export interface RoutePoint { lat: number; lng: number }
export type TravelMode = 'walking' | 'driving' | 'bicycling' | 'transit'
export interface MapRoute {
    path: RoutePoint[]
    distance: number | null
    duration: number | null
    fallback?: 'OVER_DIRECTION_RANGE' | 'UNSUPPORTED_REGION' | 'UNSUPPORTED_MODE' | 'NO_ROUTE' | 'PLANNING_FAILED'
    error?: string
    distanceText?: string
    durationText?: string
}
export interface MapProvider {
    searchPlacesPage(query: string, config?: MapProviderConfig, country?: string, options?: MapSearchOptions): Promise<MapSearchPage>
    searchPlaces(query: string, config?: MapProviderConfig, country?: string, options?: MapSearchOptions): Promise<MapSearchResult[]>
    getPlaceDetails(coordinates: MapCoordinates): Promise<PlaceDetails>
    getDirections(origin: RoutePoint, destination: RoutePoint, mode?: TravelMode): Promise<MapRoute>
}
export interface MapProviderFactory {
    createProvider(type: MapProviderType): MapProvider
    getSupportedProviders(): MapProviderType[]
}
