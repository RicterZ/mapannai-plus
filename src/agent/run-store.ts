import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ChatEvent, ChatRequest } from '../lib/ai/protocol'

/** An execution journal, not a graph checkpoint: uncertain writes are never replayed. */
export class RunStore {
    private db: Database.Database
    constructor(filename = process.env.AGENT_SQLITE_PATH || './data/agent.db') {
        mkdirSync(path.dirname(filename), { recursive: true })
        this.db = new Database(filename)
        if (filename !== ':memory:') chmodSync(filename, 0o600)
        this.db.pragma('journal_mode = WAL')
        this.db.exec(`CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, status TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
        )`)
        this.db.prepare("UPDATE runs SET status = 'interrupted' WHERE status = 'running'").run()
        this.db.exec(`CREATE TABLE IF NOT EXISTS trace_records (
            id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
        ); CREATE INDEX IF NOT EXISTS trace_run ON trace_records(run_id)`)
        this.db.prepare("DELETE FROM trace_records WHERE created_at < ?").run(new Date(Date.now() - 7 * 86400_000).toISOString())
    }
    key(request: ChatRequest) {
        // Legacy requests have no identity: never replay another client's content match.
        if (!request.conversationId || !request.requestId) return randomUUID()
        return createHash('sha256').update(JSON.stringify({ version: 2,
            conversationId: request.conversationId, requestId: request.requestId,
            messages: request.messages, context: request.context, supportsInteractions: request.supportsInteractions,
            baseUrl: request.settings.baseUrl, model: request.settings.model, credential: request.settings.apiKey })).digest('hex')
    }
    begin(id: string): { status: string; events: ChatEvent[] } | undefined {
        return this.db.transaction(() => {
            const row = this.db.prepare('SELECT status, events FROM runs WHERE id = ?').get(id) as { status: string; events: string } | undefined
            if (row) return { status: row.status, events: JSON.parse(row.events) }
            this.db.prepare("INSERT INTO runs(id,status,updated_at) VALUES (?, 'running', ?)").run(id, new Date().toISOString())
            return undefined
        })()
    }
    append(id: string, event: ChatEvent, secret: string) {
        // Persist final messages and refresh notifications, not per-token deltas or credentials.
        if (!['message', 'changed', 'title', 'complete'].includes(event.type)) return
        if (secret && JSON.stringify(event).includes(secret)) throw new Error('Sensitive output rejected')
        this.db.transaction(() => {
            const row = this.db.prepare('SELECT events FROM runs WHERE id = ?').get(id) as { events: string }
            const events = JSON.parse(row.events) as ChatEvent[]
            events.push(event)
            const encoded = JSON.stringify(events)
            if (encoded.length > 8_000_000) throw new Error('Execution journal limit exceeded')
            this.db.prepare('UPDATE runs SET events = ?, updated_at = ? WHERE id = ?').run(encoded, new Date().toISOString(), id)
        })()
    }
    finish(id: string, status: 'completed' | 'interrupted') {
        this.db.prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id)
    }
    trace(id: string, kind: string, payload: string) {
        this.db.prepare('DELETE FROM trace_records WHERE created_at < ?').run(new Date(Date.now() - 7 * 86400_000).toISOString())
        const size = (this.db.prepare('SELECT COALESCE(SUM(length(payload)), 0) AS size FROM trace_records WHERE run_id = ?').get(id) as { size: number }).size
        if (size + payload.length > 20_000_000) return
        this.db.prepare('INSERT INTO trace_records(run_id,kind,payload,created_at) VALUES (?,?,?,?)').run(id, kind, payload, new Date().toISOString())
    }
    close() { this.db.close() }
}
