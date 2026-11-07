import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTripById } from '@/lib/db/trip-service'
import { getMarkerById } from '@/lib/db/marker-service'
import { copyPlaceNoteToTrip, getTripMarkerNote, updateTripMarkerNote, TripMarkerNoteError } from '@/lib/db/trip-marker-note-service'

export const dynamic = 'force-dynamic'
type Context = { params: { id: string; markerId: string } }
const json = (data: unknown) => NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
function failure(error: unknown) {
    const status = error instanceof TripMarkerNoteError ? error.status : error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 500
    return NextResponse.json({ error: status === 500 ? '旅行笔记操作失败' : (error as Error).message }, { status })
}
export async function GET(_req: NextRequest, { params }: Context) {
    if (!getTripById(params.id) || !getMarkerById(params.markerId)) return NextResponse.json({ error: '旅行或地点不存在' }, { status: 404 })
    return json({ note: getTripMarkerNote(params.id, params.markerId) })
}
export async function PATCH(req: NextRequest, { params }: Context) {
    try { return json({ note: updateTripMarkerNote(params.id, params.markerId, await req.json()) }) }
    catch (error) { return failure(error) }
}
export async function POST(req: NextRequest, { params }: Context) {
    try {
        const { expectedUpdatedAt } = z.object({ expectedUpdatedAt: z.string().nullable() }).strict().parse(await req.json())
        return json({ note: copyPlaceNoteToTrip(params.id, params.markerId, expectedUpdatedAt) })
    } catch (error) { return failure(error) }
}
