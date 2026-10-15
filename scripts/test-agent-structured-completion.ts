import assert from 'node:assert/strict'
import { z } from 'zod'
import { structuredCompletion } from '../src/agent/structured-completion'
import type { ChatRequest } from '../src/lib/ai/protocol'

async function main() {
    const request: ChatRequest = { settings: { baseUrl: 'https://example.com/v1', apiKey: 'mock', model: 'mock' }, context: { localDate: '2026-10-15', tripId: null, dayId: null }, messages: [] }
    const schema = z.object({ ready: z.boolean() }).strict()
    let calls = 0
    const complete = async (_url: URL, _key: string, body: unknown) => {
        assert.equal((body as { stream: boolean }).stream, true)
        calls++
        const content = calls === 1 ? 'not json' : '{"ready":false}'
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    assert.deepEqual(await structuredCompletion(request, [], schema, new AbortController().signal, complete), { ready: false })
    assert.equal(calls, 2)
    calls = 0
    await assert.rejects(structuredCompletion(request, [], schema, new AbortController().signal, async () => {
        calls++; return Response.json({ choices: [{ message: { content: '{}' } }] })
    }), { name: 'StructuredOutputError' })
    assert.equal(calls, 2, 'invalid output must stop after one repair')
    calls = 0
    await assert.rejects(structuredCompletion(request, [], schema, new AbortController().signal, async () => {
        calls++; throw new Error('network')
    }))
    assert.equal(calls, 1, 'network errors are not retried')
    console.log('Structured completion: streaming, JSON compatibility, bounded repair and no network retry passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
