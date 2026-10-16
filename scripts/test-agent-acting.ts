import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import type { Workflow } from '../src/agent/workflow'
async function main() {
 const facts=Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(k=>[k,''])) as Workflow['facts']
 for(const phase of ['acting','chatting'] as const){let writes=0,round=0
 await runPlanner({settings:{baseUrl:'https://example.com',model:'mock',apiKey:''},messages:[{role:'user',content:'先把标点建立了吧'}],context:{localDate:'2026-10-16',tripId:null,dayId:null}},()=>{},new AbortController().signal,{
 assess:async()=>({phase,facts,missing:[],assumptions:[],authorized:phase==='acting',authorizationQuote:'先把标点建立了吧',dayOutline:[],affectedDays:[]}),context:h=>h,
 connect:async()=>({tools:[{type:'function',function:{name:'create_marker',description:'mock',parameters:{type:'object'}}}],call:async()=>{writes++;return {content:[]}},close:async()=>{}}),
 complete:async(_u,_k,body)=>{const b=body as any;const tail=b.messages.at(-1).content;assert.ok(!tail.includes('每天保存后调用'));assert.equal(b.tool_choice,phase==='acting'?'auto':'none');return Response.json({choices:[{message:round++?{content:'完成'}:{content:null,tool_calls:[{id:'create',type:'function',function:{name:'create_marker',arguments:'{}'}}]}}]})}
 });assert.equal(writes,phase==='acting'?1:0)}
 console.log('Independent marker creation needs no itinerary dates or preview; chatting has no planning tail')
}
main().catch(e=>{console.error(e);process.exitCode=1})
