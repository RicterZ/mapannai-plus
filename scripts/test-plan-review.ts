import assert from 'node:assert/strict'
import { reviewState } from '../src/agent/plan-review'
import type { ChatMessage } from '../src/lib/ai/protocol'
const message=(name:string,result:unknown):ChatMessage=>({role:'tool',name,tool_call_id:'test',content:JSON.stringify(result)})
assert.equal(reviewState([]).approved,false)
const approved=message('preview_itinerary',{status:'selected',selection:{action:'continue'}})
assert.equal(reviewState([approved]).approved,true)
assert.equal(reviewState([approved,message('preview_itinerary',{status:'timed_out'})]).approved,false)
assert.equal(reviewState([approved,message('submit_trip_review',{verified:true})]).completed,true)
console.log('Review state checks passed: explicit preview approval, timeout invalidation and saved completion')
