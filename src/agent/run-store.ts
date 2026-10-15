import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ChatEvent, ChatRequest } from '../lib/ai/protocol'

/** An execution journal, not a graph checkpoint: uncertain writes are never replayed. */
export class RunStore {
    private db: Database.Database
    constructor(filename = process.env.AGENT_SQLITE_PATH || './data/agent.db') {
        mkdirSync(path.dirname(filename), { recursive: true })
        this.db = new Database(filename)
        this.db.pragma('journal_mode = WAL')
        this.db.exec(`CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, status TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
        )`)
        this.db.prepare("UPDATE runs SET status = 'interrupted' WHERE status = 'running'").run()
    }
    key(request: ChatRequest) {
        // Key material is hashed only; model credentials never enter journal rows.
        return createHash('sha256').update(JSON.stringify({ messages: request.messages, context: request.context,
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
    close() { this.db.close() }
}
