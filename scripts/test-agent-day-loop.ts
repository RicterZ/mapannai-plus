import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import type { Workflow } from '../src/agent/workflow'
import type { ChatEvent, ChatRequest } from '../src/lib/ai/protocol'

async function main() {
    const request: ChatRequest = { settings: { baseUrl: 'https://example.com', apiKey: 'mock', model: 'mock' }, context: { localDate: '2026-10-15', tripId: null, dayId: null }, messages: [{ role: 'user', content: '保存旅行' }] }
    const facts = Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(key => [key, '明确'])) as Workflow['facts']
    const workflow: Workflow = { phase: 'planning', facts, missing: [], assumptions: [], authorized: true, authorizationQuote: '保存旅行', dayOutline: [{ date: '2026-10-15', theme: '到达', constraints: '下午' }, { date: '2026-10-16', theme: '离开', constraints: '晚上' }], affectedDays: [] }
    const days = [1, 2].map(index => ({ id: `day${index}`, date: `2026-10-${14 + index}`, title: '巷陌闲步', markerIds: ['a', 'b'], chains: [['a', 'b']] }))
    let writes = 0, round = 0
    let toolSnapshot: string | undefined
    const calls = [
        { name: 'update_trip_day', args: { tripId: 'trip', dayId: 'day2', title: '不该先写第二天' } },
        { name: 'finish_planning_day', args: { tripId: 'trip', dayId: 'day1' } },
        { name: 'update_trip_day', args: { tripId: 'trip', dayId: 'day2', title: '归途' } },
        { name: 'finish_planning_day', args: { tripId: 'trip', dayId: 'day2' } },
        { name: 'submit_trip_review', args: { tripId: 'trip' } },
        { name: 'update_trip_day', args: { tripId: 'trip', dayId: 'day2', title: '审阅后不可写' } },
    ]
    const events: ChatEvent[] = []
    await runPlanner(request, event => events.push(event), new AbortController().signal, {
        assess: async () => workflow, context: history => history,
        connect: async () => ({ tools: [{ type: 'function', function: { name: 'update_trip_day', description: 'mock', parameters: { type: 'object' } } }], close: async () => {}, call: async name => {
            if (name === 'get_trip_detail') return { content: [{ type: 'text', text: JSON.stringify({ id: 'trip', days }) }] }
            writes++; return { content: [{ type: 'text', text: 'saved' }] }
        } }),
        complete: async (_url, _key, body) => {
            if ((body as any).messages[0].content.includes('旅行规划阶段执行器')) return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ title: '两日巷陌' }) } }] })
            const payload = body as { tools: unknown; messages: { role: string; content?: string }[] }
            const serialized = JSON.stringify(payload.tools)
            if (toolSnapshot) assert.equal(serialized, toolSnapshot, 'tool schema/order remains stable across review transition')
            toolSnapshot = serialized
            assert.equal(payload.messages[0].role, 'system')
            assert.equal(payload.messages[1].content, request.messages[0].content, 'original conversation prefix is unchanged')
            const call = calls[round++]
            return Response.json({ choices: [{ message: { role: 'assistant', content: call ? null : '请审阅', ...(call ? { tool_calls: [{ id: `call${round}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : {}) } }] })
        },
    })
    assert.equal(writes, 1, 'cannot skip current day or write after review')
    const results = events.filter(event => event.type === 'message' && event.message.role === 'tool' && event.message.name !== 'change_title').map(event => event.type === 'message' && event.message.role === 'tool' ? JSON.parse(event.message.content) : null)
    const dailyResults = results
    assert.equal(dailyResults[0].isError, true)
    assert.equal(dailyResults[1].date, '2026-10-15')
    assert.equal(dailyResults[3].date, '2026-10-16')
    assert.equal(dailyResults[4].phase, 'review')
    assert.equal(dailyResults[5].isError, true)
    assert(events.some(event => event.type === 'complete'))
    console.log('Daily graph checks passed: ordered dates, persisted-data verification, review transition and post-review write rejection')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
