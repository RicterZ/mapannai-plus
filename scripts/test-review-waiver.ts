import assert from 'node:assert/strict'
import { hasReviewWaiver } from '../src/agent/plan-review'
import { runPlanner } from '../src/agent/planner'
import type { Workflow } from '../src/agent/workflow'
import type { ChatMessage } from '../src/lib/ai/protocol'
async function main() {
 const quote='按这个日程保存，无需再确认'
 const messages: ChatMessage[]=[{role:'user',content:quote}]
 assert.equal(hasReviewWaiver(messages,quote),true)
 assert.equal(hasReviewWaiver([{role:'assistant',content:quote}],quote),false)
 assert.equal(hasReviewWaiver([...messages,{role:'tool',name:'preview_itinerary',tool_call_id:'p',content:'{"status":"timed_out"}'}],quote),false)
 assert.equal(hasReviewWaiver([...messages,{role:'tool',name:'submit_trip_review',tool_call_id:'r',content:'{"verified":true}'}],quote),false)
 for(const missing of [[],['日期待定']]) {
 let writes=0,round=0
 const facts=Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(k=>[k,'明确'])) as Workflow['facts']
 await runPlanner({settings:{baseUrl:'https://example.com',model:'mock',apiKey:''},messages,context:{localDate:'2026-10-16',tripId:null,dayId:null}},()=>{},new AbortController().signal,{
 assess:async()=>({phase:'planning',facts,missing,assumptions:[],authorized:true,authorizationQuote:quote,skipReviewQuote:quote,dayOutline:[{date:'2026-10-16',theme:'测试',constraints:''}],affectedDays:[]}),context:h=>h,
 connect:async()=>({tools:[{type:'function',function:{name:'create_marker',description:'mock',parameters:{type:'object'}}}],call:async()=>{writes++;return {content:[]}},close:async()=>{}}),
 complete:async(_u,_k,body)=>{if((body as any).messages[0].content.includes('旅行规划阶段执行器'))return Response.json({choices:[{message:{content:'{"title":"测试"}'}}]});return Response.json({choices:[{message:round++?{content:'结束'}:{content:null,tool_calls:[{id:'c',type:'function',function:{name:'create_marker',arguments:'{}'}}]}}]})}
 });assert.equal(writes,missing.length?0:1)
 }
 console.log('Explicit waiver permits scoped save; missing facts and prior review decisions still block')
}
main().catch(e=>{console.error(e);process.exitCode=1})
