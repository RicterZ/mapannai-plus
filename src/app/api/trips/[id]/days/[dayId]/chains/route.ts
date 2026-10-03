import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRouteChain } from '@/lib/db/route-chain-service'
export const dynamic = 'force-dynamic'
const schema = z.object({ markerIds: z.array(z.string().min(1)).min(2) }).strict()
export async function POST(request: NextRequest, { params }: { params: { id: string; dayId: string } }) {
    try {
        const { markerIds } = schema.parse(await request.json())
        const { route } = createRouteChain(params.id, params.dayId, markerIds)
        return NextResponse.json(route, { status: 201 })
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '创建路线失败' }, { status: 400 }) }
}
