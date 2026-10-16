import assert from 'node:assert/strict'
import { runPlanner } from '../src/agent/planner'
import type { ChatEvent } from '../src/lib/ai/protocol'
async function main() {
 const events: ChatEvent[]=[];let round=0
 const calls=[{name:'finish_planning_day',arguments:'not-json'},{name:'finish_planning_day',arguments:'{}'},{name:'record_plan_skeleton',arguments:'{}'},{name:'search_places',arguments:'{}'}]
 await runPlanner({settings:{baseUrl:'https://example.com',apiKey:'',model:'mock'},messages:[{role:'user',content:'查询'}],context:{localDate:'2026-10-16',tripId:null,dayId:null}},e=>events.push(e),new AbortController().signal,{
 assess:async()=>undefined,context:h=>h,
 connect:async()=>({tools:[{type:'function',function:{name:'search_places',description:'mock',parameters:{type:'object'}}}],call:async()=>{throw new Error('secret credential must not leak')},close:async()=>{}}),
 complete:async(_u,_k,body)=>{const c=calls[round++];if(!c){const results=(body as any).messages.filter((m:any)=>m.role==='tool').map((m:any)=>JSON.parse(m.content));assert.equal(results.length,4);assert.equal(results[0].code,'WORKFLOW_BLOCKED');assert.equal(results[1].code,'INVALID_ARGUMENTS');assert.equal(results[2].code,'WORKFLOW_BLOCKED');assert.equal(results[3].code,'TOOL_EXECUTION_FAILED');assert.equal(results[3].executed,'unknown');assert.ok(!JSON.stringify(results).includes('secret credential'))}return Response.json({choices:[{message:c?{content:null,tool_calls:[{id:`c${round}`,type:'function',function:c}]}:{content:'结束'}}]})}
 })
 console.log('Model sees actionable guard/validation/execution errors; unexpected secrets remain hidden')
}
main().catch(e=>{console.error(e);process.exitCode=1})
