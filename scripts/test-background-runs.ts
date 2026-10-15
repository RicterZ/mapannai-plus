import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {BackgroundRuns} from '../src/agent/background-runs'
async function main(){
 const dir=mkdtempSync(path.join(tmpdir(),'agent-background-')),file=path.join(dir,'runs.db');const store=new BackgroundRuns(file)
 const input:any={conversationId:'conv',requestId:'req',settings:{apiKey:'secret'}};const token='isolated-capability';let calls=0
 try{
  const execute=async(emit:any)=>{calls++;emit({type:'status',name:'test'});await new Promise(r=>setTimeout(r,80));emit({type:'message',message:{role:'assistant',content:'background result'}});emit({type:'complete'})}
  const id=store.start(input,token,execute)
  assert.equal(store.start(input,token,execute),id)
  assert.equal(store.read(id,'other',0),null)
  await new Promise(r=>setTimeout(r,150))
  const page=store.read(id,token,0)!
  assert.equal(calls,1);assert.equal(page.status,'completed');assert.equal(page.events.length,3)
  assert.equal(store.read(id,token,page.cursor)!.events.length,0)
  const restored=new BackgroundRuns(file);assert.equal(restored.read(id,token,0)!.status,'completed');restored.close()
  const cancelId=store.start({...input,requestId:'cancel'},token,async(_emit,signal)=>{await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancel'))))})
  await new Promise(r=>setTimeout(r,10));assert.equal(store.cancel(cancelId,'wrong'),false);assert.equal(store.cancel(cancelId,token),true);await new Promise(r=>setTimeout(r,30));assert.equal(store.read(cancelId,token,0)!.status,'cancelled')
  console.log('Background runs passed: subscriber-independent completion, identity isolation, capability checks, cursor replay, restart retrieval and explicit cancel')
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1})
