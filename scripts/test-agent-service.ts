import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { NextRequest } from 'next/server'
import WebSocket from 'ws'

async function listen(server: Server) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }

async function main() {
    const directory = mkdtempSync(path.join(tmpdir(), 'mapannai-agent-'))
    process.env.SQLITE_PATH = path.join(directory, 'test.db')
    process.env.AGENT_TOKEN = 'isolated-agent-token'
    process.env.AI_ALLOW_PRIVATE_ENDPOINTS = 'true'
    const { POST: mcpPost } = await import('../src/app/api/mcp/route')
    const { POST: chatPost } = await import('../src/app/api/ai/chat/route')
    const { connectRemoteTools } = await import('../src/agent/remote-tools')
    const { getDb } = await import('../src/lib/db')
    const { getDayById } = await import('../src/lib/db/trip-service')
    const { upsertMarker } = await import('../src/lib/db/marker-service')
    const { updateRouteChain } = await import('../src/lib/db/route-chain-service')
    const mcp = createServer(async (req, res) => {
        try {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            const response = await mcpPost(new NextRequest('http://localhost/api/mcp', { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }))
            res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
            res.end(Buffer.from(await response.arrayBuffer()))
        } catch { res.writeHead(500).end() }
    })
    let requests = 0
    let cancelledModel = false
    const model = createServer(async (req, res) => {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString())
        if (body.messages[0].content.includes('旅行规划阶段执行器')) {
            const content = body.messages[0].content.includes('只生成简短自然的会话标题') ? JSON.stringify({ title: '隔离旅行' }) : JSON.stringify({ days: [{ date: '2026-10-15', theme: '古寺', constraints: '' }, { date: '2026-10-16', theme: '归途', constraints: '' }] })
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })); return
        }
        if (body.messages[0].content.includes('旅行工作流状态评估器')) {
            const facts = Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(key => [key, '用户已明确']))
            const content = JSON.stringify({ phase: 'planning', facts, missing: [], assumptions: [], authorized: true, authorizationQuote: '保存这个二日旅行', dayOutline: [], affectedDays: [] })
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })); return
        }
        if (!body.messages.some((message: any) => message.role === 'user' && message.content.startsWith('slow-stream'))) assert(body.tools.some((t: any) => t.function.name === 'update_trip_day'))
        requests++
        if (body.messages.some((message: any) => message.role === 'user' && message.content.startsWith('slow-stream'))) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.write('data: {"choices":[{"delta":{"content":"开始思考"}}]}\n\n')
            const timer = setTimeout(() => res.end('data: [DONE]\n\n'), 10_000)
            res.on('close', () => { clearTimeout(timer); cancelledModel = true })
            return
        }
        const last = body.messages.filter((message: any) => !(message.role === 'user' && (message.content.startsWith('<mapannai_context>') || message.content.startsWith('\n【程序工作流状态】')))).at(-1)
        const message = last.role === 'tool' && !['change_title', 'record_plan_skeleton'].includes(last.name) ? { content: '已保存，古寺钟声与巷陌闲步。' } : {
            content: null,
            tool_calls: [{ id: 'create', type: 'function', function: { name: 'create_trip', arguments: JSON.stringify({ name: '隔离测试', startDate: '2026-10-15', endDate: '2026-10-16', dayTitles: [{ date: '2026-10-15', title: '古寺钟声与巷陌闲步' }], operationId: 'e2e-trip' }) } }],
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...message } }] }))
    })
    let agent: ChildProcess | undefined
    let bridge: Awaited<ReturnType<typeof connectRemoteTools>> | undefined
    try {
        process.env.AGENT_MCP_URL = (await listen(mcp)) + '/api/mcp'
        const modelUrl = await listen(model)
        agent = spawn(process.execPath, ['--import', 'tsx', 'src/agent/main.ts'], {
            cwd: process.cwd(), env: { ...process.env, AGENT_HOST: '127.0.0.1', AGENT_PORT: '0', AGENT_SQLITE_PATH: path.join(directory, 'agent.db'), SQLITE_PATH: path.join(directory, 'agent-must-not-open.db') },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        process.env.AGENT_URL = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Agent subprocess startup timeout')), 15_000)
            agent!.once('error', error => { clearTimeout(timeout); reject(error) })
            agent!.once('exit', () => { clearTimeout(timeout); reject(new Error('Agent exited before ready')) })
            agent!.stdout!.on('data', chunk => {
                const match = String(chunk).match(/Agent ready on (\d+)/)
                if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`) }
            })
        })
        bridge = await connectRemoteTools()
        const signal = new AbortController().signal
        const args = { name: '幂等测试', startDate: '2026-10-15', endDate: '2026-10-16', dayTitles: [{ date: '2026-10-15', title: '巷陌闲步' }], operationId: 'same-op' }
        const first = await bridge.call('create_trip', args, signal)
        const second = await bridge.call('create_trip', args, signal)
        assert.deepEqual(second, first)
        assert((await bridge.call('create_trip', { ...args, name: 'different' }, signal)).isError)
        const trip = JSON.parse((first.content as { text: string }[])[0].text)
        assert.equal(trip.days[0].title, '巷陌闲步')
        assert((await bridge.call('create_trip', { ...args, operationId: 'bad-date', dayTitles: [{ date: '2027-01-01', title: 'bad' }] }, signal)).isError)
        const target = { tripId: trip.id, dayId: trip.days[0].id }
        upsertMarker('a', 139, 35, { title: 'A' }); upsertMarker('b', 139.01, 35, { title: 'B' })
        const chainArgs = { ...target, markerIds: ['a', 'b'], operationId: 'same-chain' }
        const chain = await bridge.call('create_day_chain', chainArgs, signal)
        assert.deepEqual(await bridge.call('create_day_chain', chainArgs, signal), chain)
        const route = getDayById(target.dayId)!.routeChains![0]
        updateRouteChain(target.tripId, target.dayId, route.id, { stops: [{ stopId: route.stops[0].id, startTime: '09:30', note: '预约入场' }], legs: [{ fromStopId: route.stops[0].id, toStopId: route.stops[1].id, mode: 'subway', serviceNumber: '银座线' }] })
        assert((await bridge.call('update_trip_day', { ...target, tripId: 'wrong', title: 'bad' }, signal)).isError)
        const before = getDayById(target.dayId)!
        assert(!(await bridge.call('update_trip_day', { ...target, title: '古寺钟声' }, signal)).isError)
        assert.deepEqual({ ...getDayById(target.dayId), title: before.title }, before)
        await bridge.call('update_trip_day', { ...target, title: null }, signal)
        assert.equal(getDayById(target.dayId)!.title, undefined)
        const input = { settings: { baseUrl: modelUrl + '/v1', apiKey: 'mock-key', model: 'mock' }, messages: [{ role: 'user', content: '保存这个二日旅行' }], context: { localDate: '2026-10-15', tripId: null, dayId: null } }
        const unauthorized = await fetch(process.env.AGENT_URL + '/chat', { method: 'POST', body: '{}' })
        assert.equal(unauthorized.status, 401)
        const response = await chatPost(new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify(input) }))
        assert.equal(response.status, 200)
        const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
        assert(events.some(e => e.type === 'changed'))
        assert(events.some(e => e.type === 'complete'))
        assert.equal(requests, 2)
        assert.equal((getDb().prepare('SELECT count(*) n FROM trips').get() as { n: number }).n, 2)
        const ws = new WebSocket(process.env.AGENT_URL.replace('http:', 'ws:') + '/chat')
        await once(ws, 'open')
        const ready = once(ws, 'message'); ws.send(JSON.stringify({ type: 'auth', token: process.env.AGENT_TOKEN }))
        assert.equal(JSON.parse(String((await ready)[0])).type, 'ready')
        const wsEvents: any[] = []
        const done = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), 10_000)
            ws.on('message', data => { const e = JSON.parse(String(data)); wsEvents.push(e); if (e.type === 'complete' || e.type === 'error') { clearTimeout(timeout); resolve() } })
        })
        ws.send(JSON.stringify({ type: 'chat', request: input })); await done
        assert(wsEvents.some(e => e.type === 'complete'))
        assert.equal((getDb().prepare('SELECT count(*) n FROM trips').get() as { n: number }).n, 2, 'same operation replay must not create another trip')
        ws.close(); await once(ws, 'close')
        const badSocket = new WebSocket(process.env.AGENT_URL.replace('http:', 'ws:') + '/chat')
        await once(badSocket, 'open')
        const rejected = once(badSocket, 'close')
        badSocket.send(JSON.stringify({ type: 'auth', token: 'wrong-token' }))
        assert.equal((await rejected)[0], 1008)
        const slow = await chatPost(new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify({ ...input, messages: [{ role: 'user', content: 'slow-stream' }] }) }))
        const reader = slow.body!.getReader()
        let streamed = ''
        while (!streamed.includes('开始思考')) {
            const delta = await reader.read()
            assert(!delta.done, 'stream must reach model delta')
            streamed += new TextDecoder().decode(delta.value)
        }
        await reader.cancel()
        for (let attempt = 0; attempt < 30 && !cancelledModel; attempt++) await new Promise(resolve => setTimeout(resolve, 100))
        assert(cancelledModel, 'cancel must propagate Web stream → WebSocket → Agent → model request')
        assert.equal(existsSync(path.join(directory, 'agent-must-not-open.db')), false, 'agent subprocess must not access the map DB')
        agent.kill('SIGTERM'); await once(agent, 'exit')
        const unavailable = await chatPost(new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify(input) }))
        assert.equal(unavailable.status, 503)
        assert(!(await unavailable.text()).includes(input.settings.apiKey))
        const requestsBeforeRestart = requests
        agent = spawn(process.execPath, ['--import', 'tsx', 'src/agent/main.ts'], {
            cwd: process.cwd(), env: { ...process.env, AGENT_HOST: '127.0.0.1', AGENT_PORT: '0', AGENT_SQLITE_PATH: path.join(directory, 'agent.db') },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        process.env.AGENT_URL = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Restart timeout')), 15_000)
            agent!.once('error', error => { clearTimeout(timer); reject(error) })
            agent!.stdout!.on('data', chunk => {
                const match = String(chunk).match(/Agent ready on (\d+)/)
                if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) }
            })
        })
        const replay = await chatPost(new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify(input) }))
        const replayEvents = (await replay.text()).trim().split('\n').map(line => JSON.parse(line))
        assert(replayEvents.some(event => event.type === 'complete'))
        assert.equal(requests, requestsBeforeRestart, 'restart replay must not rerun model or tools')
        console.log('Agent checks passed: separate Node process, real HTTP MCP + isolated SQLite, tool titles, atomic idempotency, unchanged Web NDJSON, WebSocket auth/chat, cancellation propagation, LangGraph model/tools loop.')
    } finally {
        await bridge?.close()
        if (agent && agent.exitCode === null && agent.signalCode === null) { agent.kill('SIGTERM'); await once(agent, 'exit') }
        await Promise.all([close(model), close(mcp)])
        getDb().close(); rmSync(directory, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
