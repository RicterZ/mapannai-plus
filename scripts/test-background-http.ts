import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtempSync,rmSync} from 'node:fs'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createAgentServer} from '../src/agent/server'
import {RunStore} from '../src/agent/run-store'
async function main(){
 const dir=mkdtempSync(path.join(tmpdir(),'background-http-'));process.env.AGENT_SQLITE_PATH=path.join(dir,'agent.db');process.env.AGENT_TOKEN='test-auth'
 let executions=0
 const {server,wss}=createAgentServer(async(_req,emit)=>{executions++;await new Promise(r=>setTimeout(r,100));emit({type:'message',message:{role:'assistant',content:'finished without subscriber'}});emit({type:'complete'})},new RunStore(process.env.AGENT_SQLITE_PATH))
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`
 const headers={'Content-Type':'application/json',Authorization:'Bearer test-auth','x-run-token':'capability-123456789012345678901234567890'}
 try{
 const body=JSON.stringify({conversationId:'11111111-1111-4111-8111-111111111111',requestId:'22222222-2222-4222-8222-222222222222',settings:{baseUrl:'https://example.com',model:'mock',apiKey:''},messages:[{role:'user',content:'test'}],context:{localDate:'2026-10-16',tripId:null,dayId:null}})
 const start=await fetch(url+'/runs',{method:'POST',headers,body});assert.equal(start.status,202);const {id}=await start.json()
 await new Promise(r=>setTimeout(r,200))
 const page=await (await fetch(url+'/runs/'+id,{headers})).json();assert.equal(page.status,'completed');assert.equal(page.events.length,2)
 assert.equal((await fetch(url+'/runs/'+id,{headers:{...headers,'x-run-token':'wrong-token-123456789012345678901234567890'}})).status,404)
 assert.equal((await (await fetch(url+'/runs',{method:'POST',headers,body})).json()).id,id);assert.equal(executions,1)
 console.log('Background HTTP passed: start returns before execution, disconnected subscriber recovery, isolated access and idempotent start')
 }finally{wss.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1})
