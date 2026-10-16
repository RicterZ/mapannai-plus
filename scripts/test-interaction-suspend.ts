import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import Database from 'better-sqlite3'

const dir = mkdtempSync(path.join(tmpdir(), 'agent-suspend-'))
process.env.AGENT_SQLITE_PATH = path.join(dir, 'agent.db')
delete process.env.AGENT_TOKEN

const question = { question: '更想看哪类景点？', options: [{ id: 'temple', label: '寺院' }, { id: 'street', label: '街巷' }] }
let modelCalls = 0
const keysSeen: string[] = []

async function main() {
    const { createAgentServer } = await import('../src/agent/server')
    const { runPlanner } = await import('../src/agent/planner')
    const { RunStore } = await import('../src/agent/run-store')
    const planner: typeof runPlanner = (request, emit, signal) => runPlanner(request, emit, signal, {
        assess: async () => undefined,
        context: history => history,
        connect: async () => ({ tools: [], call: async () => ({ content: [] }), close: async () => {} }) as never,
        complete: async (_url, key, body) => {
            modelCalls++
            keysSeen.push(key)
            const last = (body as { messages: { role: string; name?: string; content: string }[] }).messages.filter(message => message.role !== 'user' || !message.content.startsWith('<agent_instruction>')).at(-1)!
            const message = last.role === 'tool' && last.name === 'ask_choice'
                ? { role: 'assistant', content: `好，按${JSON.parse(last.content).summary}来。` }
                : { role: 'assistant', content: null, tool_calls: [{ id: 'ask', type: 'function', function: { name: 'ask_choice', arguments: JSON.stringify(question) } }] }
            return Response.json({ choices: [{ message }] })
        },
    }).catch(error => { if (error?.name !== 'SuspendForInteraction') console.error('[planner]', error); throw error })
    const listen = async () => {
        const instance = createAgentServer(planner, new RunStore(process.env.AGENT_SQLITE_PATH))
        await new Promise<void>(resolve => instance.server.listen(0, '127.0.0.1', resolve))
        return { ...instance, url: `http://127.0.0.1:${(instance.server.address() as AddressInfo).port}` }
    }
    const token = 'suspend-capability-0123456789abcdef0123'
    const poll = async (url: string, id: string, until: (events: any[]) => boolean) => {
        for (let i = 0; i < 100; i++) {
            const page = await (await fetch(`${url}/runs/${id}?after=0`, { headers: { 'x-run-token': token } })).json()
            if (until(page.events.map((item: any) => item.event))) return page
            await new Promise(resolve => setTimeout(resolve, 30))
        }
        const last = await (await fetch(`${url}/runs/${id}?after=0`, { headers: { 'x-run-token': token } })).json(); throw new Error('poll timeout ' + JSON.stringify(last).slice(-1500))
    }
    let first = await listen()
    try {
        const start = await fetch(`${first.url}/runs`, { method: 'POST', headers: { 'x-run-token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({
            conversationId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222', supportsInteractions: true,
            settings: { baseUrl: 'https://example.com/v1', apiKey: 'first-key', model: 'mock' }, messages: [{ role: 'user', content: '帮我想想去哪' }], context: { localDate: '2026-10-16', tripId: null, dayId: null },
        }) })
        const { id } = await start.json()
        const page = await poll(first.url, id, events => events.some(event => event.type === 'interaction'))
        const prompt = page.events.map((item: any) => item.event).find((event: any) => event.type === 'interaction').prompt
        assert.equal(prompt.deadline, null, 'suspended cards have no deadline')
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.equal(page.status, 'running', 'waiting runs look running to existing clients')
        const db = new Database(process.env.AGENT_SQLITE_PATH!, { readonly: true })
        assert.equal((db.prepare('SELECT status FROM background_runs WHERE id=?').get(id) as { status: string }).status, 'waiting')
        assert(!(db.prepare('SELECT state FROM background_suspensions').get() as { state: string }).state.includes('first-key'), 'model key is not persisted')
        db.close()

        // Restart the agent: the waiting card must still resume from the database.
        first.wss.close(); await new Promise(resolve => first.server.close(resolve))
        first = await listen()
        assert.equal((await fetch(`${first.url}/interactions`, { method: 'POST', body: JSON.stringify({ id: prompt.id, token: 'wrong-token-wrong-token-wrong-token-00', selection: ['temple'] }) })).status, 409)
        assert.equal((await fetch(`${first.url}/interactions`, { method: 'POST', body: JSON.stringify({ id: prompt.id, token: prompt.token, selection: ['nope'], apiKey: 'second-key' }) })).status, 400, 'invalid selections do not claim the card')
        assert.equal((await fetch(`${first.url}/interactions`, { method: 'POST', body: JSON.stringify({ id: prompt.id, token: prompt.token, selection: ['temple'], apiKey: 'second-key' }) })).status, 200)
        assert.equal((await fetch(`${first.url}/interactions`, { method: 'POST', body: JSON.stringify({ id: prompt.id, token: prompt.token, selection: ['street'], apiKey: 'second-key' }) })).status, 409, 'a card resumes only once')
        const done = await poll(first.url, id, events => events.some(event => event.type === 'complete'))
        const events = done.events.map((item: any) => item.event)
        assert.equal(done.status, 'completed')
        assert(events.some((event: any) => event.type === 'message' && event.message.role === 'tool' && event.message.content.includes('寺院')))
        assert(events.some((event: any) => event.type === 'message' && event.message.content === '好，按寺院来。'))
        assert.deepEqual(keysSeen, ['first-key', 'second-key'], 'the resumed run uses the key sent with the answer')

        const cancelStart = await fetch(`${first.url}/runs`, { method: 'POST', headers: { 'x-run-token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({
            conversationId: '11111111-1111-4111-8111-111111111111', requestId: '33333333-3333-4333-8333-333333333333', supportsInteractions: true,
            settings: { baseUrl: 'https://example.com/v1', apiKey: 'cancel-case-key', model: 'mock' }, messages: [{ role: 'user', content: '再问一次' }], context: { localDate: '2026-10-16', tripId: null, dayId: null },
        }) })
        const cancelId = (await cancelStart.json()).id
        const cancelPage = await poll(first.url, cancelId, list => list.some(event => event.type === 'interaction'))
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.equal((await fetch(`${first.url}/runs/${cancelId}`, { method: 'DELETE', headers: { 'x-run-token': token } })).status, 200)
        const cancelPrompt = cancelPage.events.map((item: any) => item.event).find((event: any) => event.type === 'interaction').prompt
        assert.equal((await fetch(`${first.url}/interactions`, { method: 'POST', body: JSON.stringify({ id: cancelPrompt.id, token: cancelPrompt.token, selection: ['temple'] }) })).status, 409, 'cancelled waits cannot resume')
        console.log('Interaction suspend checks passed: no deadline, waiting status, restart-safe resume, key not persisted, single resume, cancel')
    } finally {
        first.wss.close(); await new Promise(resolve => first.server.close(resolve))
        rmSync(dir, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
