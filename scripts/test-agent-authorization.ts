import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import type { Workflow } from '../src/agent/workflow'

const facts = Object.fromEntries(['destinations', 'dates', 'arrivalDeparture', 'companions', 'interests', 'budget', 'lodging', 'transportPace', 'fixedBookings', 'dietaryAccess'].map(k => [k, '明确'])) as Workflow['facts']
const trip = { id: 't1', days: [{ id: 'd1', date: '2026-12-30', title: '旧一', markerIds: ['a'], chains: [] }, { id: 'd2', date: '2026-12-31', title: '旧二', markerIds: ['a'], chains: [] }] }
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: 'mock', parameters: { type: 'object' as const } } })
const approved = [
    { role: 'assistant' as const, content: null, tool_calls: [{ id: 'p', type: 'function' as const, function: { name: 'preview_itinerary', arguments: '{}' } }] },
    { role: 'tool' as const, name: 'preview_itinerary', tool_call_id: 'p', content: JSON.stringify({ status: 'selected', selection: { action: 'continue' } }) },
]

async function run(options: { phase: Workflow['phase']; history: any[]; affectedDays?: string[]; call: { name: string; args: object }; repeat?: boolean }) {
    const writes: string[] = []
    const toolChoices: string[] = []
    let round = 0
    await runPlanner({ settings: { baseUrl: 'https://example.com', model: 'mock', apiKey: '' }, messages: [...options.history, { role: 'user', content: '把机场排进12/31，直接保存' }], context: { localDate: '2026-10-16', tripId: 't1', dayId: null } }, () => {}, new AbortController().signal, {
        assess: async () => ({ phase: options.phase, facts, missing: [], assumptions: [], authorized: true, authorizationQuote: '直接保存', dayOutline: [{ date: '2026-12-31', theme: '测试', constraints: '' }], affectedDays: options.affectedDays || [] }),
        context: h => h,
        connect: async () => ({
            tools: [tool('create_marker'), tool('create_day_chain'), tool('get_trip_detail')],
            call: async (name: string) => {
                if (name === 'get_trip_detail') return { content: [{ type: 'text', text: JSON.stringify(trip) }] }
                writes.push(name)
                return { content: [{ type: 'text', text: '{}' }] }
            },
            close: async () => {},
        }) as never,
        complete: async (_url, _key, body) => {
            const payload = body as any
            if (payload.messages[0].content.includes('旅行规划阶段执行器')) return Response.json({ choices: [{ message: { content: '{"title":"测试"}' } }] })
            toolChoices.push(payload.tool_choice)
            const again = options.repeat ? payload.tool_choice !== 'none' : round === 0
            round++
            return Response.json({ choices: [{ message: again ? { content: null, tool_calls: [{ id: `c${round}`, type: 'function', function: { name: options.call.name, arguments: JSON.stringify(options.call.args) } }] } : { content: '好了' } }] })
        },
    })
    return { writes, toolChoices }
}

async function main() {
    const revision = await run({ phase: 'revising', history: approved, affectedDays: ['2026-12-31'], call: { name: 'create_day_chain', args: { tripId: 't1', dayId: 'd2', markerIds: ['a', 'b'] } } })
    assert.deepEqual(revision.writes, ['create_day_chain'], 'approved revision writes the affected day without being forced through unaffected dates')

    const quoteOnly = await run({ phase: 'planning', history: [], call: { name: 'create_marker', args: {} } })
    assert.deepEqual(quoteOnly.writes, [], 'a save quote without draft approval cannot write itinerary data')

    const looping = await run({ phase: 'planning', history: [], call: { name: 'create_marker', args: {} }, repeat: true })
    assert.deepEqual(looping.writes, [])
    assert.equal(looping.toolChoices.length, 3, 'second identical failure stops tool use')
    assert.equal(looping.toolChoices.at(-1), 'none')

    console.log('Authorization checks passed: draft-only itinerary writes, revision scope preserved, repeated failures stop tools')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
