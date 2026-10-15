import WebSocket from 'ws'
import type { ChatRequest } from './protocol'

/** Adapt the internal WebSocket to the existing browser NDJSON stream. */
export async function proxyAgent(input: ChatRequest, signal: AbortSignal): Promise<Response> {
    const url = new URL('/chat', process.env.AGENT_URL || 'http://127.0.0.1:3100')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Agent URL')
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { maxPayload: 2_000_000, handshakeTimeout: 10_000 })
        const encoder = new TextEncoder()
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined
        let finished = false
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
        const finish = (failed: boolean) => {
            if (finished) return
            finished = true; cleanup()
            if (!controller) reject(new Error('Agent 服务暂时不可用'))
            else {
                if (failed) controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: 'Agent 连接中断；请查询已保存数据后继续' }) + '\n'))
                controller.close()
            }
            ws.close()
        }
        const abort = () => {
            if (finished) return
            finished = true; cleanup()
            if (controller) controller.error(new Error('请求已取消'))
            else reject(new Error('请求已取消'))
            ws.terminate()
        }
        const timer = setTimeout(() => finish(true), 10_000)
        signal.addEventListener('abort', abort, { once: true })
        ws.on('error', () => finish(true))
        ws.on('close', () => finish(true))
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: process.env.AGENT_TOKEN || '' })))
        ws.on('message', data => {
            if (finished) return
            try {
                const event = JSON.parse(data.toString())
                if (!controller) {
                    if (event.type !== 'ready') { finish(true); return }
                    clearTimeout(timer)
                    const body = new ReadableStream<Uint8Array>({
                        start(value) { controller = value },
                        cancel() { finished = true; cleanup(); ws.close() },
                    }, { highWaterMark: 2_000_000, size: value => value.byteLength })
                    resolve(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } }))
                    ws.send(JSON.stringify({ type: 'chat', request: input }))
                    return
                }
                if ((controller.desiredSize ?? 0) < 0) { finish(true); return }
                controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
                if (event.type === 'complete' || event.type === 'error') finish(false)
            } catch { finish(true) }
        })
        if (signal.aborted) abort()
    })
}
