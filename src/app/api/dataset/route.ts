import { PlaceReferencesValidationError } from '@/lib/places/place-references'
import { NextRequest, NextResponse } from 'next/server'
import {
    getAllMarkers,
    upsertMarker,
    deleteMarker,
} from '@/lib/db/marker-service'

// 强制动态渲染，因为使用了查询参数
export const dynamic = 'force-dynamic'

const NO_CACHE = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
}

/**
 * GET - 获取所有标记数据
 */
export async function GET(_request: NextRequest) {
    try {
        const featureCollection = getAllMarkers()

        return NextResponse.json(
            { success: true, data: featureCollection },
            { headers: NO_CACHE }
        )
    } catch (error) {
        console.error('获取标记数据失败:', error)
        return NextResponse.json(
            { error: '获取标记数据失败', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}

/**
 * POST - 创建或更新标记
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { featureId, coordinates, properties } = body

        if (!featureId || !coordinates || !properties) {
            return NextResponse.json(
                { error: '缺少必需参数: featureId, coordinates, properties' },
                { status: 400 }
            )
        }

        const feature = upsertMarker(
            featureId,
            coordinates.longitude,
            coordinates.latitude,
            properties
        )

        return NextResponse.json(
            { success: true, data: feature },
            { headers: NO_CACHE }
        )
    } catch (error) {
        if (error instanceof PlaceReferencesValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
        console.error('保存标记失败:', error)
        return NextResponse.json(
            { error: '保存标记失败', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}

/**
 * DELETE - 删除标记
 */
export async function DELETE(request: NextRequest) {
    try {
        const featureId = request.nextUrl.searchParams.get('featureId')

        if (!featureId) {
            return NextResponse.json(
                { error: '需要提供 featureId' },
                { status: 400 }
            )
        }

        // 防止误删旅行/天数据
        if (featureId.startsWith('trip_') || featureId.startsWith('day_')) {
            return NextResponse.json(
                { error: '禁止通过此接口删除旅行数据' },
                { status: 403 }
            )
        }

        deleteMarker(featureId)

        return NextResponse.json(
            { success: true, message: '标记删除成功' },
            { headers: NO_CACHE }
        )
    } catch (error) {
        console.error('删除标记失败:', error)
        return NextResponse.json(
            { error: '删除标记失败', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}
