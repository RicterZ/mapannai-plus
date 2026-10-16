import assert from 'node:assert/strict'
import { validPlanDate,validatePlanDays,datesFromFacts,resolveRevisionDates } from '../src/agent/plan-dates'
import { generateStage } from '../src/agent/plan-stages'
async function main(){
 for(const date of ['0000-00-00','2026-02-29','2026-13-01'])assert.equal(validPlanDate(date),false)
 assert.equal(validPlanDate('2024-02-29'),true)
 assert.deepEqual(datesFromFacts('2026-12-31 ~ 2027-01-02'),['2026-12-31','2027-01-01','2027-01-02'])
 assert.throws(()=>validatePlanDays([{date:'0000-00-00'}]))
 assert.throws(()=>validatePlanDays([{date:'2026-10-21'},{date:'2026-10-23'}]))
 assert.throws(()=>validatePlanDays([{date:'2026-10-21'}],['2026-10-21','2026-10-22']))
 const request:any={settings:{baseUrl:'https://example.com',apiKey:'',model:'mock'},messages:[{role:'user',content:'规划'}]}
 const workflow:any={facts:{dates:'2026-10-21'},dayOutline:[]};let calls=0
 const result=await generateStage(request,workflow,'skeleton',new AbortController().signal,async()=>Response.json({choices:[{message:{content:JSON.stringify({days:[{date:calls++?'2026-10-21':'0000-00-00',theme:'旅行',constraints:''}]})}}]}))
 assert.equal(calls,2);assert.ok('days' in result)
 await assert.rejects(generateStage(request,workflow,'skeleton',new AbortController().signal,async()=>Response.json({choices:[{message:{content:JSON.stringify({days:[{date:'0000-00-00',theme:'旅行',constraints:''}]})}}]})),{name:'StructuredOutputError'})
 const trip=['2024-12-31','2025-01-01','2025-01-02','2025-01-03','2025-01-04','2025-01-05']
 assert.deepEqual(resolveRevisionDates(trip,['2025-01-05'],['2025-01-06']),{dates:['2025-01-05','2025-01-06'],added:['2025-01-06'],unknown:[]})
 assert.deepEqual(resolveRevisionDates(trip,['2025-01-06']).unknown,['2025-01-06'],'new days require explicit addedDays')
 assert.deepEqual(resolveRevisionDates(trip,['12/31','1月5日']),{dates:['2024-12-31','2025-01-05'],added:[],unknown:[]})
 assert.deepEqual(resolveRevisionDates(trip,['2026-12-31']),{dates:['2024-12-31'],added:[],unknown:[]})
 assert.deepEqual(resolveRevisionDates(trip,[],['2025-02-10']).added,['2025-02-10'],'explicit additions need not be adjacent')
 assert.deepEqual(resolveRevisionDates(trip,[],['1月6日']).unknown,['1月6日'],'additions must be ISO dates')
 console.log('Plan date checks passed: real dates, continuity, confirmed range and bounded repair without RangeError')
}
main().catch(e=>{console.error(e);process.exitCode=1})
