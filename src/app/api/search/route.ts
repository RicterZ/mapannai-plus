import { NextRequest, NextResponse } from 'next/server'
import { mapProviderFactory } from '@/lib/map/providers'
import type { MapSearchBounds } from '@/types/map-provider'

export const dynamic = 'force-dynamic';

/**
 * GET - 使用当前配置的地图提供者搜索地点
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q')
        const limit = Math.max(1, Math.min(20, parseInt(searchParams.get('limit') || '5') || 5))
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
        const searchResults = await provider.searchPlaces(query, undefined, country, { bounds })

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
