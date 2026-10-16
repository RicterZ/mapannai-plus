import { randomBytes, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import type { ChatEvent, ChatRequest } from '../lib/ai/protocol'
import { agentErrorMessage } from './errors'

export type Execute = (emit: (event: ChatEvent) => void, signal: AbortSignal, runId: string) => Promise<void | 'suspended'>
/** Saved state of a run paused on an interaction card; the request is stored without the model key. */
export type Suspension = { interactionId: string; token: string; request: Omit<ChatRequest, 'settings'> & { settings: Omit<ChatRequest['settings'], 'apiKey'> }; transcript: ChatRequest['messages']; callId: string; toolName: string; input: unknown }

/** Durable event journal; live execution survives subscribers, not process termination. Waiting runs hold no process resources. */
export class BackgroundRuns {
    private db: Database.Database
    private live = new Map<string, AbortController>()
    constructor(filename: string) {
        this.db = new Database(filename)
        this.db.pragma('journal_mode = WAL')
        this.db.exec(`CREATE TABLE IF NOT EXISTS background_runs(id TEXT PRIMARY KEY, capability TEXT NOT NULL, identity TEXT UNIQUE, status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS background_events(run_id TEXT NOT NULL, seq INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(run_id,seq));
        CREATE TABLE IF NOT EXISTS background_suspensions(interaction_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL);`)
        this.db.prepare("UPDATE background_runs SET status='interrupted' WHERE status='running'").run()
    }
    private hash(value: string) { return createHash('sha256').update(value).digest('hex') }
    start(input: ChatRequest, capability: string, execute: Execute) {
        const identity = input.conversationId && input.requestId ? this.hash(JSON.stringify([input.conversationId,input.requestId,capability,input])) : null
        const previous = identity ? this.db.prepare('SELECT id FROM background_runs WHERE identity=?').get(identity) as {id:string}|undefined : undefined
        if(previous) return previous.id
        if(this.live.size>=4) throw new Error('Agent busy')
        const id = randomBytes(24).toString('hex')
        this.db.prepare("INSERT INTO background_runs VALUES(?,?,?,'running')").run(id,this.hash(capability),identity)
        this.run(id, input.settings.apiKey, execute)
        return id
    }
    private run(id: string, apiKey: string, execute: Execute, first?: ChatEvent) {
        const controller = new AbortController()
        this.live.set(id,controller)
        let seq=(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM background_events WHERE run_id=?').get(id) as {seq:number}).seq
        let ended=false, partial='', bytes=0, lastPartial=''
        const append = (event: ChatEvent) => {
            if(apiKey && JSON.stringify(event).includes(apiKey)) throw new Error('Sensitive output rejected')
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
        if(first) append(first)
        let suspended=false
        const flush=setInterval(()=>{if(partial && partial!==lastPartial){try{append({type:'partial',text:partial});lastPartial=partial}catch{controller.abort()}}},1000)
        void Promise.resolve().then(()=>execute(emit,controller.signal,id)).then(result=>{ suspended=result==='suspended' }).catch(error=>{
            bytes=0
            append({type:'error',message:controller.signal.aborted?'任务已停止；已保存数据保留。':agentErrorMessage(error)})
        }).finally(()=>{
            clearInterval(flush)
            // suspend() already marked the run waiting, and a resume may own it by now.
            if(!suspended || controller.signal.aborted) this.db.prepare("UPDATE background_runs SET status=? WHERE id=? AND status IN ('running','waiting')").run(ended?'completed':controller.signal.aborted?'cancelled':'failed',id)
            if(suspended && controller.signal.aborted) this.db.prepare('DELETE FROM background_suspensions WHERE run_id=?').run(id)
            if(this.live.get(id)===controller) this.live.delete(id)
        })
    }
    suspend(runId: string, state: Suspension) {
        this.db.transaction(() => {
            this.db.prepare('INSERT OR REPLACE INTO background_suspensions VALUES(?,?,?)').run(state.interactionId, runId, JSON.stringify(state))
            this.db.prepare("UPDATE background_runs SET status='waiting' WHERE id=? AND status='running'").run(runId)
        })()
    }
    /** Resumes a waiting run with the user's answer. Returns 'missing' for unknown/finished cards and 'busy' at capacity. */
    resume(interactionId: string, token: string, build: (state: Suspension) => { first: ChatEvent; execute: Execute; apiKey: string }): 'ok' | 'missing' | 'busy' {
        const row = this.db.prepare("SELECT s.run_id, s.state FROM background_suspensions s JOIN background_runs r ON r.id=s.run_id WHERE s.interaction_id=? AND r.status='waiting'").get(interactionId) as {run_id:string;state:string}|undefined
        if(!row) return 'missing'
        const state = JSON.parse(row.state) as Suspension
        if(state.token.length !== token.length || state.token !== token) return 'missing'
        if(this.live.size>=4) return 'busy'
        const next = build(state)
        // Claim the card before executing so a double submit cannot resume twice.
        const claimed = this.db.prepare("UPDATE background_runs SET status='running' WHERE id=? AND status='waiting'").run(row.run_id).changes
        if(!claimed) return 'missing'
        this.db.prepare('DELETE FROM background_suspensions WHERE interaction_id=?').run(interactionId)
        this.run(row.run_id, next.apiKey, next.execute, next.first)
        return 'ok'
    }
    read(id: string, capability: string, after: number) {
        const row=this.db.prepare('SELECT status FROM background_runs WHERE id=? AND capability=?').get(id,this.hash(capability)) as {status:string}|undefined
        if(!row) return null
        const rows=this.db.prepare('SELECT seq,event FROM background_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 100').all(id,after) as {seq:number;event:string}[]
        // Waiting is reported as running so existing clients keep polling until the card is answered.
        return {status:row.status==='waiting'?'running':row.status,events:rows.map(row=>({seq:row.seq,event:JSON.parse(row.event)})),cursor:rows.at(-1)?.seq || after}
    }
    cancel(id:string, capability:string) {
        if(!this.read(id,capability,0))return false
        this.live.get(id)?.abort()
        if(this.db.prepare("UPDATE background_runs SET status='cancelled' WHERE id=? AND status='waiting'").run(id).changes) {
            this.db.prepare('DELETE FROM background_suspensions WHERE run_id=?').run(id)
            this.db.prepare('INSERT INTO background_events VALUES(?,(SELECT COALESCE(MAX(seq),0)+1 FROM background_events WHERE run_id=?),?)').run(id,id,JSON.stringify({type:'error',message:'任务已停止；已保存数据保留。'}))
        }
        return true
    }
    close(){ this.live.forEach(controller=>controller.abort()); /* DB stays open until tasks settle on shutdown. */ }
}
