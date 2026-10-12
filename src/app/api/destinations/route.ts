import { NextRequest, NextResponse } from 'next/server'
import { searchDestinations } from '@/lib/map/destination-service'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
    const query = request.nextUrl.searchParams.get('q')?.trim()
    if (!query || query.length > 200) return NextResponse.json({ error: '请输入省市名称（最多200字）' }, { status: 400 })
    try {
        return NextResponse.json({ data: await searchDestinations(query, request.signal) })
    } catch {
        return NextResponse.json({ error: '目的地搜索失败，请稍后重试' }, { status: 500 })
    }
}
