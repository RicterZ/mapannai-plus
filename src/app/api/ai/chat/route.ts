import { NextRequest, NextResponse } from 'next/server'
import { chatRequestSchema } from '@/lib/ai/protocol'
import { completionUrl } from '@/lib/ai/endpoint'
import { proxyAgent } from '@/lib/ai/agent-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    let input
    try {
        const raw = await request.text()
        if (raw.length > 2_000_000) return NextResponse.json({ error: '聊天记录过长，请新建会话' }, { status: 413 })
        input = chatRequestSchema.parse(JSON.parse(raw))
        completionUrl(input.settings.baseUrl)
    } catch {
        return NextResponse.json({ error: '请检查 API 地址、模型和聊天内容；默认仅允许公共 HTTPS API 地址' }, { status: 400 })
    }
    try {
        return await proxyAgent(input, request.signal)
    } catch {
        return NextResponse.json({ error: 'Agent 服务暂时不可用，请稍后重试' }, { status: 503 })
    }
}
