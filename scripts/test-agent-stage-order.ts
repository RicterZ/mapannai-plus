import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import type { Workflow } from '../src/agent/workflow'
import type { ChatEvent, ChatRequest } from '../src/lib/ai/protocol'

async function main() {
    const request: ChatRequest = { settings: { baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'mock' }, messages: [{ role: 'user', content: '先看看东京两日' }], context: { localDate: '2026-10-15', tripId: null, dayId: null } }
    const facts = Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(key => [key, '已确认'])) as Workflow['facts']
    for (const collecting of [true, false]) {
        const state: Workflow = { phase: collecting ? 'collecting' : 'outline', facts, missing: collecting ? ['到达时间'] : [], assumptions: [], authorized: false, authorizationQuote: '', dayOutline: [], affectedDays: [] }
        const stages: string[] = [], events: ChatEvent[] = []
        let round = 0, writes = 0, tools = ''
        await runPlanner(request, event => events.push(event), new AbortController().signal, {
            assess: async () => { stages.push('assess'); return state }, context: history => history,
            connect: async () => ({ tools: [{ type: 'function', function: { name: 'create_trip', description: 'mock', parameters: { type: 'object' } } }], close: async () => {}, call: async () => { writes++; return { content: [] } } }),
            complete: async (_u, _k, raw) => {
                const body = raw as any
                if (body.messages[0].content.includes('旅行规划阶段执行器')) {
                    const title = body.messages[0].content.includes('只生成简短自然的会话标题')
                    stages.push(title ? 'title' : 'skeleton')
                    if (!title) assert(events.some(event => event.type === 'title'), 'title committed before skeleton request')
                    return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(title ? { title: '东京闲步' } : { days: [{ date: '2026-10-15', theme: '街巷', constraints: '下午到' }, { date: '2026-10-16', theme: '归途', constraints: '晚上离开' }] }) } }] })
                }
                stages.push('dialogue')
                const snapshot = JSON.stringify(body.tools)
                if (tools) assert.equal(snapshot, tools)
                tools = snapshot
                if (collecting && round++ === 0) return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'early-title', type: 'function', function: { name: 'change_title', arguments: '{"title":"不能提前改"}' } }] } }] })
                return Response.json({ choices: [{ message: { role: 'assistant', content: collecting ? '几点到达？' : '这是骨架，是否建立草案？' } }] })
            },
        })
        assert.equal(writes, 0)
        if (collecting) {
            assert.deepEqual(stages, ['assess', 'dialogue', 'dialogue'])
            assert(!events.some(event => event.type === 'title'))
        } else assert.deepEqual(stages, ['assess', 'title', 'skeleton', 'dialogue'])
    }
    console.log('Stage order checks passed: missing facts forbid title, ready → title → skeleton, unauthorized outline cannot write, fixed tool definitions')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
