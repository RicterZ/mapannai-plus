import { NextRequest, NextResponse } from 'next/server'
import { mapProviderFactory } from '@/lib/map/providers'

export const dynamic = 'force-dynamic';

/**
 * GET - 使用当前配置的地图提供者搜索地点
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q')
        const limit = parseInt(searchParams.get('limit') || '5')
        const country = searchParams.get('country') || undefined

        if (!query) {
            return NextResponse.json(
                { error: '需要提供搜索关键词' },
                { status: 400 }
            )
        }

        const provider = mapProviderFactory.createServiceProvider('search', searchParams.get('provider') || request.headers.get('x-map-search-provider'))
        const searchResults = await provider.searchPlaces(query, undefined, country)

        // 转换为统一格式
        const results = searchResults.slice(0, limit).map(result => ({
            id: result.name,
            name: result.name,
            coordinates: result.coordinates,
            address: result.address || '',
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
        })
    } catch (error) {
        console.error('搜索地点失败:', error)
        return NextResponse.json(
            { error: '搜索地点失败', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}
