import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import { answerInteraction, withInteractions } from '../src/agent/interactions'
import type { Workflow } from '../src/agent/workflow'
import type { ChatEvent } from '../src/lib/ai/protocol'

async function main() {
    const facts = Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(k => [k, '明确'])) as Workflow['facts']
    for (const missing of [['请确认当天安排'], []]) {
        let writes = 0, prompts = 0, round = 0
        const events: ChatEvent[] = []
        const calls = ['preview_itinerary', 'update_trip_day', 'delete_day_chain']
        await withInteractions(prompt => {
            prompts++
            assert.equal(answerInteraction(prompt.id, prompt.token, { action: 'continue', feedback: '' }), true)
        }, () => runPlanner({ settings: { baseUrl: 'https://example.com', model: 'mock', apiKey: '' }, messages: [{ role: 'user', content: '继续，保存确认后的修改' }], context: { localDate: '2026-10-15', tripId: null, dayId: null } }, e => events.push(e), new AbortController().signal, {
            assess: async () => ({ phase: 'revising', facts, missing, assumptions: [], authorized: false, authorizationQuote: '', dayOutline: [{ date: '2026-10-15', theme: '测试', constraints: '' }], affectedDays: ['2026-10-15'] }),
            context: h => h,
            connect: async () => ({ tools: calls.slice(1).map(name => ({ type: 'function' as const, function: { name, description: 'mock', parameters: { type: 'object' } } })), call: async () => { writes++; return { content: [] } }, close: async () => {} }),
            complete: async (_url, _key, body) => {
                const p = body as any
                if (p.messages[0].content.includes('旅行规划阶段执行器')) return Response.json({ choices: [{ message: { content: '{"title":"测试"}' } }] })
                const name = calls[round++]
                const args = name === 'preview_itinerary' ? { question: '是否保存？', title: '草案', days: [{ date: '2026-10-15', title: '测试', places: ['酒店'] }] } : {}
                return Response.json({ choices: [{ message: name ? { content: null, tool_calls: [{ id: `call_${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: '请确认当天安排' } }] })
            },
        }))
        assert.equal(prompts, missing.length ? 0 : 1)
        assert.equal(writes, missing.length ? 0 : 2)
        const results = events.filter(e => e.type === 'message' && e.message.role === 'tool')
        if (missing.length) {
            assert.equal(results.length, 3)
            for (const e of results) if (e.type === 'message') {
                const result = JSON.parse(e.message.content!)
                assert.equal(result.code, 'WORKFLOW_BLOCKED')
                assert.match(result.content[0].text, /请确认当天安排/)
            }
        }
    }
    console.log('Missing facts block preview and writes; clarified and approved revision can save')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
