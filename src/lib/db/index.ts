import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { newRouteChain } from '@/lib/trips/route-chain'

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'mapannai.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
    if (_db) return _db
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    initSchema(_db)
    return _db
}

function initSchema(db: Database.Database) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS trips (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            start_date  TEXT NOT NULL,
            end_date    TEXT NOT NULL,
            cover_image TEXT,
            emoji       TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trip_days (
            id          TEXT PRIMARY KEY,
            trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
            date        TEXT NOT NULL,
            title       TEXT,
            marker_ids  TEXT NOT NULL DEFAULT '[]',
            chains      TEXT NOT NULL DEFAULT '[]'
        );

        CREATE INDEX IF NOT EXISTS idx_trip_days_trip_id ON trip_days(trip_id);

        CREATE TABLE IF NOT EXISTS direction_cache (
            cache_key   TEXT PRIMARY KEY,
            route_json  TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS markers (
            id               TEXT PRIMARY KEY,
            longitude        REAL NOT NULL,
            latitude         REAL NOT NULL,
            title            TEXT,
            address          TEXT,
            header_image     TEXT,
            icon_type        TEXT NOT NULL DEFAULT 'location',
            markdown_content TEXT NOT NULL DEFAULT '',
            next             TEXT NOT NULL DEFAULT '[]',
            description      TEXT,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL
        );
    `)

    const markerCols = db.prepare('PRAGMA table_info(markers)').all() as { name: string }[]
    if (!markerCols.some(c => c.name === 'place_references')) db.exec('ALTER TABLE markers ADD COLUMN place_references TEXT')

    const tripCols = db.prepare('PRAGMA table_info(trips)').all() as { name: string }[]
    if (!tripCols.some(c => c.name === 'marker_ids')) db.exec("ALTER TABLE trips ADD COLUMN marker_ids TEXT NOT NULL DEFAULT '[]'")

    // Runtime migration: add chains column if it doesn't exist yet (for existing DBs)
    const cols = db.prepare(`PRAGMA table_info(trip_days)`).all() as { name: string }[]
    if (!cols.some(c => c.name === 'emoji')) {
        db.exec(`ALTER TABLE trip_days ADD COLUMN emoji TEXT`)
    }
    if (!cols.some(c => c.name === 'chains')) {
        db.exec(`ALTER TABLE trip_days ADD COLUMN chains TEXT NOT NULL DEFAULT '[]'`)
    }
    if (!cols.some(c => c.name === 'color_index')) {
        db.transaction(() => {
            db.exec('ALTER TABLE trip_days ADD COLUMN color_index INTEGER NOT NULL DEFAULT 0')
            const days = db.prepare('SELECT id, trip_id FROM trip_days ORDER BY trip_id, date, id').all() as { id: string; trip_id: string }[]
            const counts = new Map<string, number>()
            const update = db.prepare('UPDATE trip_days SET color_index = ? WHERE id = ?')
            for (const day of days) {
                const index = counts.get(day.trip_id) || 0
                update.run(index, day.id)
                counts.set(day.trip_id, index + 1)
            }
        })()
    }
    if (!cols.some(c => c.name === 'route_chains')) {
        db.transaction(() => {
            db.exec("ALTER TABLE trip_days ADD COLUMN route_chains TEXT NOT NULL DEFAULT '[]'")
            const days = db.prepare('SELECT id, chains FROM trip_days').all() as { id: string; chains: string }[]
            const update = db.prepare('UPDATE trip_days SET route_chains = ? WHERE id = ?')
            for (const day of days) {
                const routes = (JSON.parse(day.chains || '[]') as string[][]).map(newRouteChain)
                update.run(JSON.stringify(routes), day.id)
            }
        })()
    }

}
