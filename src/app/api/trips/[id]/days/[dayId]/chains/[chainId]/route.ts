import { NextRequest, NextResponse } from 'next/server'
import { deleteRouteChain, updateRouteChain } from '@/lib/db/route-chain-service'
import { getDayById } from '@/lib/db/trip-service'
import { routeChainPatchSchema } from '@/lib/trips/route-chain-schema'
export const dynamic = 'force-dynamic'
type Params = { params: { id: string; dayId: string; chainId: string } }
export async function PATCH(request: NextRequest, { params }: Params) {
    try {
        const patch = routeChainPatchSchema.parse(await request.json())
        return NextResponse.json(updateRouteChain(params.id, params.dayId, params.chainId, patch))
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : '修改路线失败' }, { status: 400 })
    }
}
export async function DELETE(_request: NextRequest, { params }: Params) {
    try { return NextResponse.json(deleteRouteChain(params.id, params.dayId, params.chainId)) }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '删除路线失败' }, { status: 400 }) }
}
export async function GET(_request: NextRequest, { params }: Params) {
    const day = getDayById(params.dayId)
    const route = day?.tripId === params.id ? day.routeChains?.find(item => item.id === params.chainId) : null
    return route ? NextResponse.json(route) : NextResponse.json({ error: '路线不存在' }, { status: 404 })
}
