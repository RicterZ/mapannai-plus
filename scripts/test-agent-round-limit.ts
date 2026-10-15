import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import { chatRequestSchema } from '../src/lib/ai/protocol'
import { HISTORY_KEY, readHistory } from '../src/lib/ai/local-history'

async function main() {
    const messages = Array.from({ length: 1200 }, () => ({ role: 'user' as const, content: '继续' }))
    const request = { settings: { baseUrl: 'https://example.com', model: 'mock', apiKey: '' }, context: { localDate: '2026-10-16', tripId: null, dayId: null }, messages }
    assert.equal(chatRequestSchema.safeParse(request).success, true)
    assert.equal(chatRequestSchema.safeParse({ ...request, messages: [...messages, messages[0]] }).success, false)
    const saved = JSON.stringify({ version: 1, activeId: 'test', conversations: [{ id: 'test', title: '测试', updatedAt: new Date().toISOString(), messages }] })
    assert.equal(readHistory({ getItem: key => key === HISTORY_KEY ? saved : null }).conversations[0].messages.length, 1200)
    for (const rounds of [40, 65]) {
        let calls = 0
        const run = runPlanner({ settings: { baseUrl: 'https://example.com', model: 'mock', apiKey: '' }, context: { localDate: '2026-10-16', tripId: null, dayId: null }, messages: Array.from({ length: 200 }, () => ({ role: 'user' as const, content: '继续' })) }, () => {}, new AbortController().signal, {
            assess: async () => undefined, context: h => h,
            connect: async () => ({ tools: [{ type: 'function', function: { name: 'list_trips', description: 'mock', parameters: { type: 'object' } } }], call: async () => ({ content: [] }), close: async () => {} }),
            complete: async () => Response.json({ choices: [{ message: ++calls <= rounds ? { content: null, tool_calls: [{ id: `call_${calls}`, type: 'function', function: { name: 'list_trips', arguments: '{}' } }] } : { content: '完成' } }] }),
        })
        if (rounds === 40) { await run; assert.equal(calls, 41) }
        else { await assert.rejects(run, /本轮工具调用较多/); assert.equal(calls, 64) }
    }
    console.log('40 tool rounds and 200-message history succeed; 64-round safety limit remains enforced')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
