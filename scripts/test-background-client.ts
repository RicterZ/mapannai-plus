import assert from 'node:assert/strict'
import {pollBackground,type PendingRun} from '../src/lib/ai/background-client'
async function main(){
 const previous=globalThis.fetch;const run:PendingRun={id:'test',token:'cap',conversationId:'conv',cursor:5};let saved=0
 try{globalThis.fetch=async(url,init)=>{assert.ok(String(url).includes('after=5'));assert.equal(new Headers(init?.headers).get('x-run-token'),'cap');return Response.json({status:'completed',events:[{seq:6,event:{type:'message',message:{role:'assistant',content:'resumed'}}},{seq:7,event:{type:'complete'}}]})}
 const events:string[]=[];await pollBackground(run,new AbortController().signal,e=>events.push(e.type),()=>saved++)
 assert.deepEqual(events,['message','complete']);assert.equal(run.cursor,7);assert.equal(run.terminal,true);assert.ok(saved>=2)
 console.log('Web polling checks passed: saved cursor, capability header, resumed events and terminal detection')
 }finally{globalThis.fetch=previous}
}
main().catch(e=>{console.error(e);process.exitCode=1})
