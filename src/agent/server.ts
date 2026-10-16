import { BackgroundRuns } from './background-runs'
import { withInteractions, answerInteraction, interactionResult, SuspendForInteraction } from './interactions'
import { createServer, type IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { chatRequestSchema, chatMessageSchema, type ChatEvent, type ChatMessage } from '../lib/ai/protocol'
import { completionUrl } from '../lib/ai/endpoint'
import { runPlanner } from './planner'
import { RunStore } from './run-store'
import { agentErrorMessage } from './errors'
import { traceAgent, withAgentTrace, agentTraceEnabled } from '../lib/ai/trace'

const MAX_BODY = 2_000_000
function authorized(value: unknown) {
    const expected = process.env.AGENT_TOKEN || ''
    if (!expected) return true // Only supported on loopback, enforced at startup.
    if (typeof value !== 'string') return false
    const a = Buffer.from(value), b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
}

export function createAgentServer(planner = runPlanner, store = new RunStore()) {
    const background = new BackgroundRuns(process.env.AGENT_SQLITE_PATH || './data/agent.db')
    let active = 0
    /** runId enables suspension: interaction cards end the run and are resumed later from the saved transcript. */
    const execute = async (raw: unknown, emit: (event: ChatEvent) => void, signal: AbortSignal, runId?: string): Promise<void | 'suspended'> => {
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
        const transcript: ChatMessage[] = [...input.messages]
        try {
            return await withAgentTrace({ secrets: [input.settings.apiKey, ...Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD|SECURITY_CODE/i.test(key)).map(([, value]) => value || '')],
                write: (kind, payload) => { if (agentTraceEnabled()) store.trace(id, kind, payload) },
            }, async (): Promise<void | 'suspended'> => {
                traceAgent('request', input)
                try {
                    const invoke = () => planner(input, event => {
                        if (event.type !== 'delta') traceAgent('event', event)
                        store.append(id, event, input.settings.apiKey)
                        if (event.type === 'message') transcript.push(event.message)
                        if (event.type === 'complete') { store.finish(id, 'completed'); completed = true }
                        emit(event)
                    }, signal)
                    if (input.supportsInteractions) await withInteractions(prompt => emit({ type: 'interaction', prompt }), invoke, { suspend: !!runId })
                    else await invoke()
                } catch (error) {
                    if (error instanceof SuspendForInteraction && runId) {
                        const { apiKey: _omitted, ...settings } = input.settings
                        background.suspend(runId, { interactionId: error.prompt.id, token: error.prompt.token, request: { ...input, settings, messages: [] }, transcript, callId: error.callId, toolName: error.toolName, input: error.prompt.input })
                        traceAgent('suspended', { tool: error.toolName })
                        return 'suspended'
                    }
                    traceAgent('failure', { name: error instanceof Error ? error.name : 'UnknownError',
                        message: error instanceof Error ? error.message : '', stack: error instanceof Error ? error.stack : '' })
                    throw error
                }
            })
        } finally { store.finish(id, completed ? 'completed' : 'interrupted'); active-- }
    }
    const server = createServer(async (req, res) => {
        if (req.url === '/health' && req.method === 'GET') { res.writeHead(200).end('ok'); return }
        if (req.url?.startsWith('/runs')) {
            if (!authorized(req.headers.authorization?.replace(/^Bearer /, ''))) { res.writeHead(401).end(); return }
            const capability = req.headers['x-run-token']
            if (typeof capability !== 'string' || !/^[a-zA-Z0-9-]{32,100}$/.test(capability)) { res.writeHead(400).end(); return }
            try {
                const url = new URL(req.url, 'http://localhost')
                if (url.pathname === '/runs' && req.method === 'POST') {
                    let text=''; for await (const chunk of req) { text+=chunk; if(text.length>MAX_BODY){res.writeHead(413).end();return} }
                    const input=chatRequestSchema.parse(JSON.parse(text)); completionUrl(input.settings.baseUrl)
                    const id=background.start(input,capability,(emit,signal,runId)=>execute(input,emit,signal,runId))
                    res.writeHead(202,{'Content-Type':'application/json'}).end(JSON.stringify({id}));return
                }
                const id=url.pathname.slice('/runs/'.length)
                if(req.method==='DELETE'){res.writeHead(background.cancel(id,capability)?200:404).end();return}
                const after=Number(url.searchParams.get('after') || 0)
                if(!Number.isSafeInteger(after)||after<0){res.writeHead(400).end();return}
                const result=background.read(id,capability,after)
                res.writeHead(result?200:404,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));return
            } catch {res.writeHead(400).end();return}
        }
        if (req.url === '/interactions' && req.method === 'POST') {
            if (!authorized(req.headers.authorization?.replace(/^Bearer /, ''))) { res.writeHead(401).end(); return }
            try {
                let body = ''
                for await (const chunk of req) { body += chunk; if (body.length > 16000) { res.writeHead(413).end(); return } }
                const value = JSON.parse(body)
                if (typeof value.id !== 'string' || typeof value.token !== 'string') { res.writeHead(400).end(); return }
                if (answerInteraction(value.id, value.token, value.selection)) { res.writeHead(200).end(); return }
                const resumed = background.resume(value.id, value.token, state => {
                    const message = chatMessageSchema.parse({ role: 'tool', name: state.toolName, tool_call_id: state.callId, content: JSON.stringify(interactionResult(state.input as never, value.selection)) })
                    const apiKey = typeof value.apiKey === 'string' ? value.apiKey : ''
                    const input = chatRequestSchema.parse({ ...state.request, settings: { ...state.request.settings, apiKey }, messages: [...state.transcript, message] })
                    return { apiKey, first: { type: 'message', message }, execute: (emit, signal, runId) => execute(input, emit, signal, runId) }
                })
                res.writeHead(resumed === 'ok' ? 200 : resumed === 'busy' ? 503 : 409).end()
            } catch { res.writeHead(400).end() }
            return
        }
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
            } catch (error) { emit({ type: 'error', message: agentErrorMessage(error) }) }
        })
        ws.on('error', () => running?.abort())
        ws.on('close', () => { clearTimeout(timer); running?.abort() })
    })
    server.on('close', () => store.close())
    return { server, wss }
}
