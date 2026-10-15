import { createServer, type IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { chatRequestSchema, type ChatEvent } from '../lib/ai/protocol'
import { completionUrl } from '../lib/ai/endpoint'
import { runPlanner } from './planner'
import { RunStore } from './run-store'

const MAX_BODY = 2_000_000
function authorized(value: unknown) {
    const expected = process.env.AGENT_TOKEN || ''
    if (!expected) return true // Only supported on loopback, enforced at startup.
    if (typeof value !== 'string') return false
    const a = Buffer.from(value), b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
}

export function createAgentServer(planner = runPlanner, store = new RunStore()) {
    let active = 0
    const execute = async (raw: unknown, emit: (event: ChatEvent) => void, signal: AbortSignal) => {
        if (active >= 4) throw new Error('Agent 忙碌，请稍后重试')
        const input = chatRequestSchema.parse(raw)
        completionUrl(input.settings.baseUrl)
        const id = store.key(input)
        const previous = store.begin(id)
        if (previous) {
            if (previous.status === 'running') throw new Error('此请求正在运行')
            for (const event of previous.events) {
                if (previous.status !== 'completed' && event.type === 'complete') continue
                emit(event)
            }
            if (previous.status !== 'completed') emit({ type: 'error', message: '上次执行已中断，以上为已记录结果。请发送“查询当前数据并继续”，不要重复提交原请求；未返回结果的写入可能已经成功。' })
            return
        }
        active++
        let completed = false
        try {
            await planner(input, event => {
                store.append(id, event, input.settings.apiKey)
                if (event.type === 'complete') { store.finish(id, 'completed'); completed = true }
                emit(event)
            }, signal)
        } finally { store.finish(id, completed ? 'completed' : 'interrupted'); active-- }
    }
    const server = createServer(async (req, res) => {
        if (req.url === '/health' && req.method === 'GET') { res.writeHead(200).end('ok'); return }
        if (req.url !== '/chat' || req.method !== 'POST') { res.writeHead(404).end(); return }
        if (!authorized(req.headers.authorization?.replace(/^Bearer /, ''))) { res.writeHead(401).end(); return }
        const abort = new AbortController()
        res.on('close', () => abort.abort())
        try {
            let size = 0
            const chunks: Buffer[] = []
            for await (const chunk of req) {
                size += chunk.length
                if (size > MAX_BODY) { res.writeHead(413).end(); return }
                chunks.push(Buffer.from(chunk))
            }
            const input = chatRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            completionUrl(input.settings.baseUrl)
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
            await execute(input, event => {
                if (abort.signal.aborted) return
                if (res.writableLength > MAX_BODY) { abort.abort(); res.destroy(); return }
                res.write(JSON.stringify(event) + '\n')
            }, abort.signal)
        } catch {
            if (!abort.signal.aborted) {
                if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/x-ndjson' })
                res.write(JSON.stringify({ type: 'error', message: 'Agent 请求失败；已执行的写入可能保留，请查询后继续' }) + '\n')
            }
        } finally { res.end() }
    })
    server.requestTimeout = 30_000
    server.headersTimeout = 10_000
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY })
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
        // Browser access stays behind Web; this internal interface has no ambient cookie auth.
        if (req.url !== '/chat' || req.headers.origin || wss.clients.size >= 64) { socket.destroy(); return }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    })
    wss.on('connection', ws => {
        let running: AbortController | undefined
        let authenticated = false
        const timer = setTimeout(() => { if (!authenticated) ws.close(1008, 'Authentication required') }, 5000)
        const emit = (event: ChatEvent) => {
            if (ws.readyState !== WebSocket.OPEN) return
            if (ws.bufferedAmount > MAX_BODY) { running?.abort(); ws.close(1013, 'Slow consumer'); return }
            ws.send(JSON.stringify(event))
        }
        ws.on('message', async bytes => {
            try {
                const message = JSON.parse(bytes.toString())
                if (!authenticated) {
                    if (message.type !== 'auth' || !authorized(message.token)) { ws.close(1008, 'Unauthorized'); return }
                    authenticated = true; clearTimeout(timer)
                    ws.send(JSON.stringify({ type: 'ready' })); return
                }
                if (message.type === 'cancel') { running?.abort(); return }
                if (message.type !== 'chat' || running) throw new Error('Invalid state')
                running = new AbortController()
                try { await execute(message.request, emit, running.signal) } finally { running = undefined }
            } catch { emit({ type: 'error', message: 'Agent 请求失败；请检查输入或查询已保存数据后继续' }) }
        })
        ws.on('error', () => running?.abort())
        ws.on('close', () => { clearTimeout(timer); running?.abort() })
    })
    server.on('close', () => store.close())
    return { server, wss }
}
