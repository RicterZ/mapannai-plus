// Before deployment: --backup /app/data/pre-trip-notes.db. After startup: no arguments verifies the migration.
const Database = require('better-sqlite3')
const path = require('node:path')
const fs = require('node:fs')

async function main() {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--backup')) throw new Error('Usage: node check-trip-marker-notes-migration.cjs [--backup <new-file>]')
    const source = path.resolve(process.env.SQLITE_PATH || './data/mapannai.db')
    const db = new Database(source, { readonly: true, fileMustExist: true })
    try {
        if (args.length) {
            const destination = path.resolve(args[1])
            // Reserve the filename atomically so an existing backup can never be overwritten.
            fs.closeSync(fs.openSync(destination, 'wx', 0o600))
            await db.backup(destination)
        }
        const hasNotes = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'trip_marker_notes'").get()
        if (!args.length && !hasNotes) throw new Error('Trip note migration has not run')
        if (hasNotes) {
            const columns = db.prepare('PRAGMA table_info(trip_marker_notes)').all()
            for (const name of ['trip_id', 'marker_id', 'title', 'content', 'updated_at']) if (!columns.some(column => column.name === name)) throw new Error(`Missing column: ${name}`)
            const keys = db.prepare('PRAGMA foreign_key_list(trip_marker_notes)').all()
            if (!['trips', 'markers'].every(table => keys.some(key => key.table === table && key.on_delete === 'CASCADE'))) throw new Error('Missing cascading foreign keys')
        }
        if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed')
        if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Integrity check failed')
        const count = table => db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count
        console.log(JSON.stringify({ backupCreated: !!args.length, integrity: 'ok', foreignKeys: 'ok', tripNoteTable: hasNotes,
            markers: count('markers'), trips: count('trips'), days: count('trip_days'), tripNotes: hasNotes ? count('trip_marker_notes') : 0 }))
    } finally { db.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
