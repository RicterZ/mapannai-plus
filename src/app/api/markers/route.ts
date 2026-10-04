import { NextRequest, NextResponse } from 'next/server'
import { getAllMarkers, upsertMarker, findNearbyMarker, generateCoordinateHash, featureToMarker } from '@/lib/db/marker-service'
import { parsePlaceReferences, PlaceReferencesValidationError } from '@/lib/places/place-references'

export async function GET() {
    try { return NextResponse.json(getAllMarkers().features.map(featureToMarker)) }
    catch { return NextResponse.json({ error: '获取标记失败' }, { status: 500 }) }
}
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { coordinates, title, iconType, address, content } = body
        const references = body.placeReferences === undefined ? undefined : parsePlaceReferences(body.placeReferences)
        if (!coordinates || !title || !iconType) return NextResponse.json({ error: '缺少必需参数: coordinates, title, iconType' }, { status: 400 })
        if (!Number.isFinite(coordinates.longitude) || !Number.isFinite(coordinates.latitude) || Math.abs(coordinates.longitude) > 180 || Math.abs(coordinates.latitude) > 90) return NextResponse.json({ error: '需要有效坐标' }, { status: 400 })
        // Deduplication does not establish POI identity: leave existing references untouched.
        const existing = findNearbyMarker(coordinates.longitude, coordinates.latitude, 10)
        if (existing) return NextResponse.json(featureToMarker(existing))
        const id = `coord_${generateCoordinateHash(coordinates.longitude, coordinates.latitude)}`
        const feature = upsertMarker(id, coordinates.longitude, coordinates.latitude, {
            placeReferences: references, address: address || null, markdownContent: content || '',
            headerImage: null, iconType, metadata: { title },
        })
        return NextResponse.json(featureToMarker(feature))
    } catch (error) {
        return NextResponse.json({ error: error instanceof PlaceReferencesValidationError ? error.message : '创建标记失败' }, { status: error instanceof PlaceReferencesValidationError ? 400 : 500 })
    }
}
