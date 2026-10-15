import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createAgentServer } from '../src/agent/server'
import { RunStore } from '../src/agent/run-store'
import { requestInteraction } from '../src/agent/interactions'
import { POST } from '../src/app/api/ai/interactions/route'
import { NextRequest } from 'next/server'
async function main() {
 process.env.AGENT_TOKEN='isolated-interaction-token'
 const {server,wss}=createAgentServer(async(_request,emit,signal)=>{
   const result=await requestInteraction('ask_choice',{question:'偏好',options:[{id:'food',label:'美食'},{id:'walk',label:'散步'}]},signal)
   emit({type:'message',message:{role:'assistant',content:JSON.stringify(result)}});emit({type:'complete'})
 },new RunStore(':memory:'))
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.AGENT_URL=url
 try {
  const response=await fetch(url+'/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.AGENT_TOKEN},body:JSON.stringify({supportsInteractions:true,settings:{baseUrl:'https://example.com',apiKey:'',model:'mock'},messages:[{role:'user',content:'选择'}],context:{localDate:'2026-10-15',tripId:null,dayId:null}})})
  const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',prompt:any,done=false
  while(!done){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;const event=JSON.parse(line);if(event.type==='interaction'){
   prompt=event.prompt
   const submit=()=>POST(new NextRequest('http://localhost/api/ai/interactions',{method:'POST',body:JSON.stringify({id:prompt.id,token:prompt.token,selection:['food']})}))
   assert.equal((await submit()).status,200);assert.equal((await submit()).status,409)
  }if(event.type==='message')assert.equal(JSON.parse(event.message.content).status,'selected');if(event.type==='complete')done=true}}
  assert.ok(prompt);console.log('Interaction HTTP transport and Web submission proxy passed')
 }finally{wss.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
main().catch(e=>{console.error(e);process.exitCode=1})
