import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import type { Workflow } from '../src/agent/workflow'
async function main(){
 const facts=Object.fromEntries(['destinations','dates','arrivalDeparture','companions','interests','budget','lodging','transportPace','fixedBookings','dietaryAccess'].map(k=>[k,'明确'])) as Workflow['facts']
 for(const phase of ['planning','chatting'] as const){let writes=0,round=0;let tools=''
 await runPlanner({settings:{baseUrl:'https://example.com',model:'mock',apiKey:''},messages:[{role:'user',content:'你好'}],context:{localDate:'2026-10-15',tripId:null,dayId:null}},()=>{},new AbortController().signal,{
 assess:async()=>({phase,facts,missing:[],assumptions:[],authorized:phase==='planning',authorizationQuote:'你好',dayOutline:[{date:'2026-10-15',theme:'测试',constraints:''}],affectedDays:[]}),context:h=>h,
 connect:async()=>({tools:[{type:'function',function:{name:'create_marker',description:'mock',parameters:{type:'object'}}}],call:async()=>{writes++;return {content:[]}},close:async()=>{}}),
 complete:async(_url,_key,body)=>{const p=body as any;if(p.messages[0].content.includes('旅行规划阶段执行器'))return Response.json({choices:[{message:{content:'{"title":"测试"}'}}]});const snapshot=JSON.stringify(p.tools);if(tools)assert.equal(snapshot,tools);tools=snapshot;if(phase==='chatting')assert.equal(p.tool_choice,'none');return Response.json({choices:[{message:round++?{content:'已结束'}:{content:null,tool_calls:[{id:'write',type:'function',function:{name:'create_marker',arguments:'{}'}}]}}]})}
 });assert.equal(writes,0,'unapproved draft and chatting cannot write')}
 console.log('Draft gates passed: unapproved writes blocked, chatting tools blocked, definitions stable')
}
main().catch(e=>{console.error(e);process.exitCode=1})
