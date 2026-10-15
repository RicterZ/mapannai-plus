import assert from 'node:assert/strict'
import { withAgentTrace, traceAgent, agentTraceEnabled } from '../src/lib/ai/trace'
import { RunStore } from '../src/agent/run-store'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

async function main() {
    const env: Record<string, string | undefined> = process.env
    const oldMode = env.NODE_ENV, oldFlag = process.env.AGENT_TRACE_ENABLED
    try {
        delete process.env.AGENT_TRACE_ENABLED
        env.NODE_ENV = 'development'; assert.equal(agentTraceEnabled(), true)
        env.NODE_ENV = 'production'; assert.equal(agentTraceEnabled(), false)
        process.env.AGENT_TRACE_ENABLED = 'true'; assert.equal(agentTraceEnabled(), true)
        env.NODE_ENV = 'development'; process.env.AGENT_TRACE_ENABLED = 'false'; assert.equal(agentTraceEnabled(), false)
    } finally {
        if (oldMode === undefined) delete env.NODE_ENV; else env.NODE_ENV = oldMode
        if (oldFlag === undefined) delete process.env.AGENT_TRACE_ENABLED; else process.env.AGENT_TRACE_ENABLED = oldFlag
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-trace-'))
    const file = path.join(dir, 'agent.db')
    const store = new RunStore(file)
    try {
        await withAgentTrace({ secrets: ['private"key'], write: (kind, payload) => store.trace('test', kind, payload) }, async () => {
            traceAgent('request', { settings: { apiKey: 'private"key' }, content: 'echo private"key', url: 'https://example.com/img?signature=private' })
            await Promise.resolve()
            traceAgent('failure', { message: 'upstream private"key' })
        })
        const db = new Database(file)
        try {
            const rows = db.prepare('SELECT * FROM trace_records ORDER BY id').all() as {payload: string}[]
            assert.equal(rows.length, 2)
            for (const row of rows) assert.ok(!JSON.parse(row.payload).content?.includes('private"key'))
            assert.ok(!JSON.stringify(rows).includes('signature='))
            assert.equal(JSON.parse(rows[0].payload).settings.apiKey, '[REDACTED]')
            assert.equal(JSON.parse(rows[1].payload).message, 'upstream [REDACTED]')
            assert.equal(statSync(file).mode & 0o777, 0o600)
            db.prepare('UPDATE trace_records SET created_at = ?').run('2000-01-01T00:00:00.000Z')
            store.trace('test', 'later', '{}')
            assert.equal((db.prepare('SELECT count(*) AS n FROM trace_records').get() as {n:number}).n, 1)
        } finally { db.close() }
        assert.doesNotThrow(() => withAgentTrace({ secrets: [], write: () => { throw new Error('disk') } }, () => traceAgent('test', {})))
        console.log('Trace checks passed: async context, secret/URL redaction, private DB permissions, retention and nonfatal recording failures')
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
