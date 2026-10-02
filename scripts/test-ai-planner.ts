import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { NextRequest } from 'next/server'
import { readCompletion } from '../src/lib/ai/completions'
import { completionUrl, isPublicAddress, requestCompletion } from '../src/lib/ai/endpoint'
import { chatMessageSchema, repairInterruptedMessages, type ChatEvent, type ChatMessage, type ChatRequest } from '../src/lib/ai/protocol'
import { HISTORY_KEY, SETTINGS_KEY, readHistory, readSettings, writeSettings } from '../src/lib/ai/local-history'

const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-ai-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
const signal = new AbortController().signal
const assistant = (content: string | null, calls?: Array<{ name: string; args: unknown }>) => Response.json({ choices: [{ message: {
    role: 'assistant', content,
    ...(calls ? { tool_calls: calls.map((call, i) => ({ id: `call_${i}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}),
} }] })
const context = { localDate: '2026-10-01', tripId: null, dayId: null }
const settings = { baseUrl: 'https://ai.example/v1', apiKey: 'dummy-test-key', model: 'mock-tools-model' }

async function main() {
    try {
        // Import DB-dependent modules only after the isolated path has been set.
        const { runPlanner } = await import('../src/lib/ai/planner')
        const { getAllTrips } = await import('../src/lib/db/trip-service')
        const { POST } = await import('../src/app/api/ai/chat/route')
        const { planningPrompt } = await import('../src/lib/ai/prompt')
        const { attachTripContext } = await import('../src/lib/ai/trip-context')
        const { GET: getPrompt } = await import('../src/app/api/ai/prompt/route')
        const promptResponse = await getPrompt()
        assert.equal(promptResponse.status, 200)
        assert.equal(promptResponse.headers.get('Cache-Control'), 'no-store')
        assert.deepEqual(await promptResponse.json(), { prompt: planningPrompt })
        assert.equal(getAllTrips().length, 0, 'test must start in an empty isolated DB')
        // Public endpoint validation, including mapped IPv4 and explicit private opt-in.
        assert.equal(completionUrl('https://ai.example/v1/').pathname, '/v1/chat/completions')
        assert.equal(completionUrl('https://ai.example/v1/chat/completions').pathname, '/v1/chat/completions')
        for (const url of ['https://localhost/v1', 'http://ai.example/v1', 'https://127.0.0.1/v1', 'https://[::ffff:127.0.0.1]/v1', 'https://u:p@ai.example/v1', 'https://ai.example/v1?key=secret']) assert.throws(() => completionUrl(url, false))
        for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(ip), false, ip)
        assert.equal(isPublicAddress('8.8.8.8'), true)
        assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
        assert.equal(completionUrl('http://localhost:11434/v1', true).pathname, '/v1/chat/completions')

        // Stream UTF-8 and CRLF boundaries one byte at a time, including fragmented tool arguments.
        const frames = [
            { choices: [{ delta: { content: '东京' } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'list_trips', arguments: '{' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
        ].map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
        const bytes = new TextEncoder().encode(frames)
        let index = 0, text = ''
        const response = new Response(new ReadableStream({ pull(controller) {
            if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index))
            else controller.close()
        } }), { headers: { 'Content-Type': 'text/event-stream' } })
        const parsed = await readCompletion(response, delta => { text += delta }, signal)
        assert.equal(text, '东京'); assert.equal(parsed.tool_calls?.[0].function.arguments, '{}')
        await assert.rejects(() => readCompletion(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), () => {}, signal), /中断/)
        await assert.rejects(() => readCompletion(Response.json({ error: 'invalid' }), () => {}, signal), /有效回复/)

        // Real registered MCP schemas + real services against an isolated SQLite DB.
        const events: ChatEvent[] = []
        let rounds = 0
        const first: ChatRequest = { settings, context, messages: [{ role: 'user', content: '创建东京三日旅行' }] }
        await runPlanner(first, event => events.push(event), signal, { complete: async (_url, key, body) => {
            assert.equal(key, settings.apiKey)
            const payload = body as { tools: Array<{ function: { name: string; parameters: unknown } }>; messages: ChatMessage[] }
            assert(payload.tools.some(tool => tool.function.name === 'create_trip' && tool.function.parameters))
            assert(payload.tools.some(tool => tool.function.name === 'create_day_chain'))
            assert.equal(payload.messages[0].content, planningPrompt)
            assert(planningPrompt.length < 1500, 'product identity and workflow should remain concise')
            const firstUser = payload.messages.find(message => message.role === 'user')!
            const attached = JSON.parse(firstUser.content!.split('以下为应用附加的当前数据：\n')[1].split('\n</mapannai_context>')[0])
            assert.equal(attached.trips.length, rounds === 0 ? 0 : 1, 'trip list refreshes after writes within the tool loop')
            if (rounds++ === 0) return assistant(null, [{ name: 'create_trip', args: { name: '东京三日', startDate: '2026-10-10', endDate: '2026-10-12' } }])
            assert.equal(payload.messages.at(-1)?.role, 'tool')
            return assistant('已创建东京三日旅行。')
        } })
        assert.equal(rounds, 2)
        assert.equal(getAllTrips().length, 1)
        assert(events.some(event => event.type === 'changed'))
        assert.equal(events.at(-1)?.type, 'complete')
        assert.equal(first.messages[0].content, '创建东京三日旅行', 'attached context must not mutate saved user messages')
        const transcript = [...first.messages, ...events.filter((event): event is Extract<ChatEvent, { type: 'message' }> => event.type === 'message').map(event => event.message)]
        let secondRound = 0
        await runPlanner({ ...first, messages: [...transcript, { role: 'user', content: '继续查看刚创建的旅行' }] }, () => {}, signal, { complete: async (_url, _key, body) => {
            const payload = body as { messages: ChatMessage[] }
            assert(payload.messages.some(message => message.role === 'assistant' && message.content?.includes('已创建')))
            const firstUser = payload.messages.find(message => message.role === 'user')!
            assert.equal(firstUser.content!.split('<mapannai_context>').length, 2, 'append context only once')
            assert(firstUser.content!.includes(getAllTrips()[0].id), 'existing trip ID is supplied without list_trips')
            if (secondRound++ === 0) return assistant(null, [{ name: 'get_trip_detail', args: { tripId: getAllTrips()[0].id } }])
            assert.equal(payload.messages.at(-1)?.role, 'tool')
            return assistant('找到了东京三日旅行。')
        } })
        assert.equal(getAllTrips().length, 1, 'second turn must not recreate the trip')
        const otherTopic: ChatMessage[] = [{ role: 'user', content: '另一话题的安排' }]
        const assembled = attachTripContext(otherTopic, context)
        assert.equal(assembled.length, 1)
        assert(!assembled[0].content?.includes('已创建东京三日旅行'), 'do not carry conversation history across topics')
        assert.equal(otherTopic[0].content, '另一话题的安排')

        let invalidRound = 0
        await runPlanner(first, () => {}, signal, { complete: async (_url, _key, body) => {
            if (invalidRound++ === 0) return assistant(null, [{ name: 'create_trip', args: {} }, { name: 'unknown_tool', args: {} }])
            const payload = body as { messages: ChatMessage[] }
            assert(payload.messages.filter(message => message.role === 'tool').every(message => JSON.parse(message.content).isError))
            return assistant('参数不足，请补充旅行信息。')
        } })
        assert.equal(getAllTrips().length, 1, 'invalid arguments cannot write data')
        const aborted = new AbortController(); aborted.abort()
        await assert.rejects(() => runPlanner(first, () => {}, aborted.signal))

        // Interrupted tool batches remain protocol-valid without re-executing calls.
        const pending: ChatMessage = { role: 'assistant', content: null, tool_calls: [{ id: 'pending', type: 'function', function: { name: 'create_trip', arguments: '{}' } }] }
        const repaired = repairInterruptedMessages([first.messages[0], pending])
        assert.equal(repaired.at(-1)?.role, 'tool')
        assert.equal(repairInterruptedMessages(repaired).length, repaired.length)
        assert(repaired.every(message => chatMessageSchema.safeParse(message).success))

        // History reload and key persistence opt-in, without touching browser or production storage.
        const values = new Map<string, string>()
        const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) } }
        writeSettings(storage, { ...settings, rememberKey: false })
        assert(!values.get(SETTINGS_KEY)?.includes(settings.apiKey))
        assert.equal(readSettings(storage).apiKey, '')
        writeSettings(storage, { ...settings, rememberKey: true })
        assert.equal(readSettings(storage).apiKey, settings.apiKey)
        writeSettings(storage, { ...settings, rememberKey: false })
        assert(!values.get(SETTINGS_KEY)?.includes(settings.apiKey))
        values.set(HISTORY_KEY, JSON.stringify({ version: 1, activeId: 'test', conversations: [{ id: 'test', title: '东京', updatedAt: new Date().toISOString(), messages: transcript }] }))
        assert.deepEqual(readHistory(storage).conversations[0].messages, transcript)
        values.set(HISTORY_KEY, '{broken'); assert.throws(() => readHistory(storage)); assert.equal(values.get(HISTORY_KEY), '{broken')

        // Real HTTP proxy transport, redirect refusal, and no upstream error-body/key leakage.
        let sawKey = false
        const server = createServer((req, res) => {
            sawKey = req.headers.authorization === `Bearer ${settings.apiKey}`
            req.resume()
            if (req.url?.startsWith('/redirect')) { res.writeHead(302, { Location: 'http://127.0.0.1/target' }); res.end(); return }
            if (req.url?.startsWith('/failure')) { res.writeHead(401); res.end(settings.apiKey); return }
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.end('data: {"choices":[{"delta":{"content":"连接成功"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const address = server.address() as { port: number }
        try {
            const base = `http://127.0.0.1:${address.port}`
            const connected = await requestCompletion(completionUrl(base, true), settings.apiKey, {}, signal, true)
            assert.equal((await readCompletion(connected, () => {}, signal)).content, '连接成功'); assert(sawKey)
            await assert.rejects(() => requestCompletion(completionUrl(base + '/redirect', true), settings.apiKey, {}, signal, true), /HTTP 302/)
            await assert.rejects(() => requestCompletion(completionUrl(base + '/failure', true), settings.apiKey, {}, signal, true), error => error instanceof Error && /HTTP 401/.test(error.message) && !error.message.includes(settings.apiKey))
        } finally { await new Promise<void>(resolve => server.close(() => resolve())) }

        const invalid = await POST(new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify({ ...first, settings: { ...settings, baseUrl: 'http://localhost:1' } }) }))
        assert.equal(invalid.status, 400)
        assert(!(await invalid.text()).includes(settings.apiKey))
        console.log('AI planner checks passed: streaming, real MCP tool loop, isolated DB, multi-turn history, invalid tools, interruption, local storage, endpoint validation, HTTP transport, redirects, and key redaction.')
    } finally { rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
