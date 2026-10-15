import { randomBytes, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import type { ChatEvent, ChatRequest } from '../lib/ai/protocol'
import { agentErrorMessage } from './errors'

/** Durable event journal; live execution survives subscribers, not process termination. */
export class BackgroundRuns {
    private db: Database.Database
    private live = new Map<string, AbortController>()
    constructor(filename: string) {
        this.db = new Database(filename)
        this.db.pragma('journal_mode = WAL')
        this.db.exec(`CREATE TABLE IF NOT EXISTS background_runs(id TEXT PRIMARY KEY, capability TEXT NOT NULL, identity TEXT UNIQUE, status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS background_events(run_id TEXT NOT NULL, seq INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(run_id,seq));`)
        this.db.prepare("UPDATE background_runs SET status='interrupted' WHERE status='running'").run()
    }
    private hash(value: string) { return createHash('sha256').update(value).digest('hex') }
    start(input: ChatRequest, capability: string, execute: (emit: (event: ChatEvent) => void, signal: AbortSignal) => Promise<void>) {
        const identity = input.conversationId && input.requestId ? this.hash(JSON.stringify([input.conversationId,input.requestId,capability,input])) : null
        const previous = identity ? this.db.prepare('SELECT id FROM background_runs WHERE identity=?').get(identity) as {id:string}|undefined : undefined
        if(previous) return previous.id
        if(this.live.size>=4) throw new Error('Agent busy')
        const id = randomBytes(24).toString('hex'), controller = new AbortController()
        this.db.prepare("INSERT INTO background_runs VALUES(?,?,?,'running')").run(id,this.hash(capability),identity)
        this.live.set(id,controller)
        let seq=0, ended=false, partial='', bytes=0, lastPartial=''
        const append = (event: ChatEvent) => {
            if(input.settings.apiKey && JSON.stringify(event).includes(input.settings.apiKey)) throw new Error('Sensitive output rejected')
            const text=JSON.stringify(event)
            bytes+=text.length
            if(bytes>32_000_000) throw new Error('Background event limit exceeded')
            this.db.prepare('INSERT INTO background_events VALUES(?,?,?)').run(id,++seq,text)
        }
        const emit = (event: ChatEvent) => {
            // Persist cumulative partial text at bounded intervals, not one SQL row per token.
            if(event.type==='delta') { partial+=event.text; return }
            if(event.type==='message' && event.message.role==='assistant') partial=''
            append(event)
            if(event.type==='complete') ended=true
        }
        const flush=setInterval(()=>{if(partial && partial!==lastPartial){try{append({type:'partial',text:partial});lastPartial=partial}catch{controller.abort()}}},1000)
        void Promise.resolve().then(()=>execute(emit,controller.signal)).catch(error=>{
            bytes=0
            append({type:'error',message:controller.signal.aborted?'任务已停止；已保存数据保留。':agentErrorMessage(error)})
        }).finally(()=>{
            clearInterval(flush)
            this.db.prepare('UPDATE background_runs SET status=? WHERE id=?').run(ended?'completed':controller.signal.aborted?'cancelled':'failed',id)
            this.live.delete(id)
        })
        return id
    }
    read(id: string, capability: string, after: number) {
        const row=this.db.prepare('SELECT status FROM background_runs WHERE id=? AND capability=?').get(id,this.hash(capability)) as {status:string}|undefined
        if(!row) return null
        const rows=this.db.prepare('SELECT seq,event FROM background_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 100').all(id,after) as {seq:number;event:string}[]
        return {status:row.status,events:rows.map(row=>({seq:row.seq,event:JSON.parse(row.event)})),cursor:rows.at(-1)?.seq || after}
    }
    cancel(id:string, capability:string) { if(!this.read(id,capability,0))return false;this.live.get(id)?.abort();return true }
    close(){ this.live.forEach(controller=>controller.abort()); /* DB stays open until tasks settle on shutdown. */ }
}
