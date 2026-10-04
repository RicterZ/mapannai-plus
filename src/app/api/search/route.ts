import { NextRequest, NextResponse } from 'next/server'
import { mapProviderFactory } from '@/lib/map/providers'
import { parseSearchPagination } from '@/lib/map/search-pagination'
import type { MapSearchBounds } from '@/types/map-provider'

export const dynamic = 'force-dynamic';

/**
 * GET - 使用当前配置的地图提供者搜索地点
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q')
        let pagination: ReturnType<typeof parseSearchPagination>
        try { pagination = parseSearchPagination(searchParams) }
        catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }) }
        const country = searchParams.get('country') || undefined
        let bounds: MapSearchBounds | undefined
        if (searchParams.has('bounds')) {
            try {
                const value = JSON.parse(searchParams.get('bounds')!)
                if (!value || !['west', 'east', 'south', 'north'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) || value.south < -90 || value.north > 90 || value.south >= value.north || value.west < -180 || value.east > 180 || value.west >= value.east) throw new Error('Invalid bounds')
                bounds = { west: value.west, east: value.east, south: value.south, north: value.north }
            } catch {
                return NextResponse.json({ error: '搜索范围无效' }, { status: 400 })
            }
        }

        if (!query) {
            return NextResponse.json(
                { error: '需要提供搜索关键词' },
                { status: 400 }
            )
        }

        const provider = mapProviderFactory.createServiceProvider('search')
        if (pagination.paginated && pagination.page > 1 && !pagination.pageToken && process.env.MAP_SEARCH_PROVIDER !== 'amap') {
            return NextResponse.json({ error: 'Google 翻页需要上一页返回的 pageToken' }, { status: 400 })
        }
        const resultPage = await provider.searchPlacesPage(query, undefined, country, {
            bounds, signal: request.signal,
            page: pagination.paginated ? pagination.page : 1,
            pageSize: pagination.paginated ? pagination.pageSize : 20,
            pageToken: pagination.pageToken,
        })
        const searchResults = pagination.paginated ? resultPage.results : resultPage.results.slice(0, pagination.limit)

        // 转换为统一格式
        const results = searchResults.map(result => ({
            id: result.name,
            name: result.name,
            coordinates: result.coordinates,
            address: result.address || '',
            placeReferences: result.placeReferences,
            placeId: result.placeId || '',
            rating: result.rating || 0,
            types: result.types || [],
            properties: {},
            bbox: undefined,
        }))

        return NextResponse.json({
            success: true,
            data: results,
            query,
            ...(pagination.paginated ? {
                page: resultPage.page, pageSize: resultPage.pageSize,
                hasMore: resultPage.hasMore, nextPage: resultPage.nextPage,
                nextPageToken: resultPage.nextPageToken, total: resultPage.total,
            } : {}),
        })
    } catch (error) {
        console.error('搜索地点失败:', error)
        return NextResponse.json(
            { error: '搜索地点失败', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}
