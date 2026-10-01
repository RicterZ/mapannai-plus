import assert from 'node:assert/strict'
import { createdMarkerIds } from '../src/lib/ai/use-ai-map-effects'
import type { ChatMessage } from '../src/lib/ai/protocol'

const result = (name: string, data: unknown): ChatMessage => ({ role: 'tool', name, tool_call_id: 'test', content: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(data) }] }) })
const places = [{ id: 'new', status: 'created' }, { id: 'existing', status: 'existing' }, { name: 'failed', status: 'error' }, { id: 'new', status: 'created' }]
assert.deepEqual(createdMarkerIds(result('create_marker', places)), ['new'])
assert.deepEqual(createdMarkerIds(result('plan_trip_day', { results: places })), ['new'])
assert.deepEqual(createdMarkerIds(result('search_places', places)), [])
assert.deepEqual(createdMarkerIds(result('update_marker', places)), [])
assert.deepEqual(createdMarkerIds({ role: 'assistant', content: 'created' }), [])
assert.deepEqual(createdMarkerIds({ role: 'tool', name: 'create_marker', tool_call_id: 'x', content: 'invalid JSON' }), [])
assert.deepEqual(createdMarkerIds({ role: 'tool', name: 'create_marker', tool_call_id: 'x', content: JSON.stringify({ isError: true, content: [{ type: 'text', text: JSON.stringify(places) }] }) }), [])
console.log('AI map effects checks passed: new-place results, batch results, deduplication, existing places, unrelated tools, and malformed or failed results.')
