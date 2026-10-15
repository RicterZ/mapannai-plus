import assert from 'node:assert/strict'
import { assessWorkflow } from '../src/agent/workflow'
import type { ChatRequest } from '../src/lib/ai/protocol'

async function main() {
    const request: ChatRequest = { settings: { baseUrl: 'https://example.com/v1', apiKey: 'mock', model: 'mock' }, context: { localDate: '2026-10-15', tripId: null, dayId: null }, messages: [{ role: 'user', content: '先推荐一下东京' }] }
    const facts = Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(key => [key, '']))
    let value = { phase: 'planning', facts, missing: [] as string[], assumptions: [], authorized: true, authorizationQuote: '保存东京旅行', dayOutline: [], affectedDays: [] }
    const complete = async () => Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) } }] })
    const run = () => assessWorkflow(request, new AbortController().signal, complete)
    assert.equal((await run()).authorized, false, 'invented authorization quote rejected')
    request.messages.push({ role: 'user', content: '保存东京旅行' })
    assert.equal((await run()).authorized, true)
    value.missing = ['到达时间']; assert.equal((await run()).authorized, false, 'missing key facts block writes')
    value.missing = []; value.phase = 'review'; assert.equal((await run()).authorized, false)
    value.phase = 'completed'; assert.equal((await run()).authorized, false)
    value.phase = 'collecting'; assert.equal((await run()).authorized, false)
    value.phase = 'revising'; assert.equal((await run()).authorized, true)
    console.log('Workflow checks passed: exact user evidence, missing facts, collecting/review/completed write gates and revision authorization')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
