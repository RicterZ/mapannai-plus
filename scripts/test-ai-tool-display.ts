import assert from 'node:assert/strict'
import { groupChatMessages, toolFailed } from '../src/lib/ai/tool-display'
import type { ChatMessage } from '../src/lib/ai/protocol'
const tool = (content = '{}'): Extract<ChatMessage, { role: 'tool' }> => ({ role: 'tool', name: 'update_marker', tool_call_id: 'test', content })
const groups = groupChatMessages([
    { role: 'user', content: '规划' },
    { role: 'assistant', content: null }, tool(),
    { role: 'assistant', content: null }, tool('{"isError":true}'),
    { role: 'assistant', content: '安排如下' }, tool(),
])
assert.equal(groups.length, 4)
assert.equal(groups[1].type, 'tools')
if (groups[1].type === 'tools') assert.equal(groups[1].messages.length, 2)
assert.equal(toolFailed(tool()), false)
assert.equal(toolFailed(tool('{"isError":true}')), true)
assert.equal(toolFailed(tool('invalid')), true)
assert.equal(toolFailed(tool(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ results: [{ status: 'error' }] }) }] }))), true)
assert.deepEqual(groupChatMessages([]), [])
console.log('Tool display checks passed: continuous grouping, reply boundaries and nested failures')
