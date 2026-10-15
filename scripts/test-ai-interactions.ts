import assert from 'node:assert/strict'
import { validateSelection, interactionSchema } from '../src/lib/ai/interaction'
import { answerInteraction, requestInteraction, withInteractions } from '../src/agent/interactions'
async function main() {
 const choice=interactionSchema.parse({kind:'ask_choice',question:'选择',multiple:true,maxSelections:2,options:[{id:'a',label:'甲'},{id:'b',label:'乙'}]})
 assert.throws(()=>validateSelection(choice,['unknown']))
 assert.throws(()=>validateSelection(choice,['a','a']))
 assert.deepEqual(validateSelection(choice,['a','b']),['a','b'])
 const date=interactionSchema.parse({kind:'ask_datetime',question:'日期',mode:'date_range',timezone:'Asia/Tokyo'})
 assert.throws(()=>validateSelection(date,{start:'2026-02-30',end:'2026-03-02'}))
 assert.throws(()=>validateSelection(date,{start:'2026-03-02',end:'2026-03-01'}))
 const result=await withInteractions(prompt=>{
   assert.equal(answerInteraction(prompt.id,'wrong',['a']),false)
   assert.equal(answerInteraction(prompt.id,prompt.token,['a']),true)
   assert.equal(answerInteraction(prompt.id,prompt.token,['b']),false)
 },()=>requestInteraction('ask_choice',{question:'选择',options:[{id:'a',label:'甲'},{id:'b',label:'乙'}]},new AbortController().signal))
 assert.equal((result as {status:string}).status,'selected')
 const abort=new AbortController()
 await assert.rejects(withInteractions(()=>abort.abort(),()=>requestInteraction('ask_datetime',{question:'日期',mode:'date',timezone:'Asia/Tokyo'},abort.signal)))
 assert.equal((await requestInteraction('ask_datetime',{question:'日期',mode:'date',timezone:'Asia/Tokyo'},new AbortController().signal) as {status:string}).status,'unsupported')
 const start=Date.now()
 const timed=await withInteractions(()=>{},()=>requestInteraction('ask_datetime',{question:'日期',mode:'date',timezone:'Asia/Tokyo'},new AbortController().signal)) as {status:string}
 assert.equal(timed.status,'timed_out');assert.ok(Date.now()-start>=29000)
 console.log('Interaction tests passed: validation, one-shot tokens, cancellation, legacy fallback and real 30s timeout')
}
main().catch(e=>{console.error(e);process.exitCode=1})
