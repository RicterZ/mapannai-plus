import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RunStore } from '../src/agent/run-store'
import { completedDates, verifySavedDay } from '../src/agent/day-progress'
import type { ChatRequest } from '../src/lib/ai/protocol'

const directory = mkdtempSync(path.join(tmpdir(), 'mapannai-recovery-'))
const filename = path.join(directory, 'agent.db')
const request: ChatRequest = { conversationId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222', settings: { baseUrl: 'https://example.com', apiKey: 'must-not-persist-this-key', model: 'mock' }, context: { localDate: '2026-10-15', tripId: null, dayId: null }, messages: [{ role: 'user', content: '保存行程' }] }
let store = new RunStore(filename)
try {
    const id = store.key(request)
    assert.equal(store.key(request), id, 'same identified request replays')
    assert.notEqual(store.key({ ...request, conversationId: '33333333-3333-4333-8333-333333333333' }), id, 'same text in another conversation must not replay')
    assert.notEqual(store.key({ ...request, requestId: '44444444-4444-4444-8444-444444444444' }), id, 'new send in same conversation must not replay')
    const legacy = { ...request, conversationId: undefined, requestId: undefined }
    assert.notEqual(store.key(legacy), store.key(legacy), 'legacy clients never share content-hash replay')
    assert.notEqual(store.key({ ...request, messages: [{ role: 'user', content: '不同输入' }] }), id, 'changed input cannot replay old events')

    assert.equal(store.begin(id), undefined)
    assert.equal(store.begin(id)!.status, 'running', 'parallel duplicate must not execute')
    store.append(id, { type: 'message', message: { role: 'assistant', content: '地点已保存' } }, request.settings.apiKey)
    store.append(id, { type: 'changed' }, request.settings.apiKey)
    assert.throws(() => store.append(id, { type: 'message', message: { role: 'assistant', content: request.settings.apiKey } }, request.settings.apiKey))
    store.close()
    store = new RunStore(filename)
    const restored = store.begin(id)!
    assert.equal(restored.status, 'interrupted', 'restart must not automatically replay unknown writes')
    assert.equal(restored.events.length, 2)
    store.finish(id, 'completed')
    assert.equal(store.begin(id)!.status, 'completed')
    assert.equal(readFileSync(filename).includes(Buffer.from(request.settings.apiKey)), false)
    assert.notEqual(store.key({ ...request, settings: { ...request.settings, apiKey: 'other-owner' } }), id)
    const detail = { days: [{ id: 'day1', date: '2026-10-15', title: '巷陌闲步', markerIds: ['a', 'b'], chains: [['a', 'b']] }] }
    const verified = verifySavedDay(detail, 'day1', '2026-10-15')
    assert.equal(verified.verified, true)
    assert.throws(() => verifySavedDay(detail, 'day1', '2026-10-16'))
    assert.throws(() => verifySavedDay({ days: [{ ...detail.days[0], title: '' }] }, 'day1'))
    assert.throws(() => verifySavedDay({ days: [{ ...detail.days[0], chains: [] }] }, 'day1'))
    assert.throws(() => verifySavedDay({ days: [{ ...detail.days[0], chains: [['a', 'unknown']] }] }, 'day1'))
    const dates = completedDates([{ role: 'tool', name: 'finish_planning_day', tool_call_id: 'finish', content: JSON.stringify(verified) }])
    assert(dates.has('2026-10-15'))
    console.log('Recovery checks passed: persistent journal, interrupted run detection, duplicate exclusion, credential isolation, daily saved-data validation')
} finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
