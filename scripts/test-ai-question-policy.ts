import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import { planningPrompt } from '../src/lib/ai/prompt'
async function main(){
 assert.ok(planningPrompt.includes('禁止“顺便问一句”'))
 let round=0,writes=0
 await runPlanner({settings:{baseUrl:'https://example.com',apiKey:'',model:'mock'},messages:[{role:'user',content:'规划'}],context:{localDate:'2026-10-15',tripId:null,dayId:null}},()=>{},new AbortController().signal,{
  assess:async()=>undefined,context:history=>history,
  connect:async()=>({tools:[{type:'function',function:{name:'create_marker',description:'mock',parameters:{type:'object'}}}],call:async()=>{writes++;return {content:[]}},close:async()=>{}}),
  complete:async(_url,_key,body)=>{
   const messages=(body as {messages:{role:string;content:string}[]}).messages
   if(round++) {assert.ok(messages.some(m=>m.role==='tool'&&m.content.includes('本批未执行任何操作')));return Response.json({choices:[{message:{content:'继续逐项询问'}}]})}
   return Response.json({choices:[{message:{content:null,tool_calls:[{id:'ask',type:'function',function:{name:'ask_datetime',arguments:'{}'}},{id:'write',type:'function',function:{name:'create_marker',arguments:'{}'}}]}}]})
  },
 })
 assert.equal(writes,0)
 console.log('Sequential question policy: mixed interaction/write batch rejected without side effects')
}
main().catch(e=>{console.error(e);process.exitCode=1})
