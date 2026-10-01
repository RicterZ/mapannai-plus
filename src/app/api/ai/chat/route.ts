import { NextRequest, NextResponse } from 'next/server'
import { chatRequestSchema, type ChatEvent } from '@/lib/ai/protocol'
import { completionUrl } from '@/lib/ai/endpoint'
import { runPlanner } from '@/lib/ai/planner'

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
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) abort.abort()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const emit = (event: ChatEvent) => {
                if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
            }
            void runPlanner(input, emit, abort.signal).catch(error => {
                if (!abort.signal.aborted) emit({ type: 'error', message: error instanceof Error && !error.message.includes(input.settings.apiKey || '\0')
                    ? error.message : 'AI 请求失败，请检查配置后重试' })
            }).finally(() => {
                request.signal.removeEventListener('abort', onAbort)
                if (!abort.signal.aborted) controller.close()
            })
        },
        cancel() { abort.abort(); request.signal.removeEventListener('abort', onAbort) },
    })
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
