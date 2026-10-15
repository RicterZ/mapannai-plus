import { createHash } from 'node:crypto'
import { getDb } from './index'

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    return value
}

/** Synchronous business writes and their replay result commit in the same SQLite transaction. */
export function idempotentOperation<T>(name: string, operationId: string | undefined, args: unknown, write: () => T): T {
    const db = getDb()
    return db.transaction(() => {
        if (!operationId) return write()
        const key = `${name}:${operationId}`
        const hash = createHash('sha256').update(JSON.stringify(canonical(args))).digest('hex')
        const previous = db.prepare('SELECT args_hash, result_json FROM tool_operations WHERE operation_key = ?').get(key) as { args_hash: string; result_json: string } | undefined
        if (previous) {
            if (previous.args_hash !== hash) throw new Error('同一 operationId 不能用于不同参数')
            return JSON.parse(previous.result_json) as T
        }
        const result = write()
        db.prepare('INSERT INTO tool_operations(operation_key, args_hash, result_json) VALUES (?, ?, ?)').run(key, hash, JSON.stringify(result))
        return result
    })()
}
