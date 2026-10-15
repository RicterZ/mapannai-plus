import assert from 'node:assert/strict'
import { assessWorkflow, canChangeTitle } from '../src/agent/workflow'
import type { ChatRequest } from '../src/lib/ai/protocol'

async function main() {
    const request: ChatRequest = { settings: { baseUrl: 'https://example.com/v1', apiKey: 'mock', model: 'mock' }, context: { localDate: '2026-10-15', tripId: null, dayId: null }, messages: [{ role: 'user', content: '先推荐一下东京' }] }
    const facts = Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(key => [key, '']))
    let value = { phase: 'planning', facts, missing: [] as string[], assumptions: [], authorized: true, authorizationQuote: '保存东京旅行', dayOutline: [], affectedDays: [] }
    request.messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'call_mock', type: 'function', function: { name: 'change_title', arguments: '{}' } }] })
    request.messages.push({ role: 'tool', tool_call_id: 'call_mock', content: '{}' })
    const complete = async (_url: URL, _key: string, body: unknown) => {
        const messages = (body as { messages: { role: string; content: unknown }[] }).messages
        assert.ok(messages.every(message => typeof message.content === 'string' && message.content.trim().length > 0), 'tool-only assistant must not become an invalid null-content turn')
        assert.ok(messages.every(message => message.role !== 'tool'), 'assessment excludes tool results')
        return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) } }] })
    }
    for (const phase of ['collecting', 'review', 'completed'] as const) assert.equal(canChangeTitle({ ...value, phase } as any), false)
    assert.equal(canChangeTitle({ ...value, phase: 'outline', authorized: false } as any), true, 'title precedes outline without write authorization')
    assert.equal(canChangeTitle({ ...value, missing: ['到达时间'] } as any), false)
    const run = () => assessWorkflow(request, new AbortController().signal, complete)
    assert.equal((await run()).authorized, false, 'invented authorization quote rejected')
    request.messages.push({ role: 'user', content: '保存东京旅行' })
    assert.equal((await run()).authorized, true)
    value.missing = ['到达时间']; assert.equal((await run()).authorized, false, 'missing key facts block writes')
    value.missing = []; value.phase = 'review'; assert.equal((await run()).authorized, false)
    value.phase = 'completed'; assert.equal((await run()).authorized, false)
    value.phase = 'collecting'; assert.equal((await run()).authorized, false)
    value.phase = 'revising'; assert.equal((await run()).authorized, true)
    request.messages.push({ role: 'tool', name: 'ask_choice', tool_call_id: 'selected', content: JSON.stringify({ status: 'selected', source: 'user', selection: ['food'], summary: '美食' }) })
    request.messages.push({ role: 'user', content: '改成自然风光' })
    await assessWorkflow(request, new AbortController().signal, async (_url, _key, body) => {
        const messages = (body as {messages:{content:string|null}[]}).messages
        assert.ok(messages[messages.length - 2].content?.includes('美食'))
        assert.equal(messages[messages.length - 1].content, '改成自然风光', 'later user correction remains last')
        return Response.json({choices:[{message:{content:JSON.stringify(value)}}]})
    })
    console.log('Workflow checks passed: exact user evidence, missing facts, collecting/review/completed write gates and revision authorization')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
