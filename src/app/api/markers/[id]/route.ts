import { NextRequest, NextResponse } from 'next/server'
import { getMarkerById, updateMarkerFields, deleteMarker, featureToMarker } from '@/lib/db/marker-service'
import { PlaceReferencesValidationError } from '@/lib/places/place-references'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const feature = getMarkerById(params.id)
        return feature ? NextResponse.json(featureToMarker(feature)) : NextResponse.json({ error: '标记未找到' }, { status: 404 })
    } catch { return NextResponse.json({ error: '获取标记失败' }, { status: 500 }) }
}
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const updated = updateMarkerFields(params.id, await request.json())
        return updated ? NextResponse.json(featureToMarker(updated)) : NextResponse.json({ error: '标记未找到' }, { status: 404 })
    } catch (error) {
        return NextResponse.json({ error: error instanceof PlaceReferencesValidationError ? error.message : '更新标记失败' }, { status: error instanceof PlaceReferencesValidationError ? 400 : 500 })
    }
}
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
    try {
        if (!getMarkerById(params.id)) return NextResponse.json({ error: '标记未找到' }, { status: 404 })
        deleteMarker(params.id)
        return NextResponse.json({ success: true })
    } catch { return NextResponse.json({ error: '删除标记失败' }, { status: 500 }) }
}
