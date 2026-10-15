import { fetchWithAuth } from '../fetch-with-auth'
import type { InteractionPrompt } from './interaction'
import type { ChatEvent, ChatRequest } from './protocol'
export const PENDING_RUN_KEY='mapannai:ai-pending-run:v1'
export type PendingRun={id:string;token:string;conversationId:string;cursor:number; prompt?:InteractionPrompt}
export async function startBackground(input:ChatRequest,token:string,signal:AbortSignal){
 const response=await fetchWithAuth('/api/ai/runs',{method:'POST',headers:{'Content-Type':'application/json','x-run-token':token},body:JSON.stringify(input),signal})
 if(!response.ok)throw new Error('后台任务启动失败，请重试')
 return (await response.json()).id as string
}
export async function pollBackground(run:PendingRun,signal:AbortSignal,onEvent:(event:ChatEvent)=>void,save:()=>void){
 let failures=0
 while(!signal.aborted){
  let response:Response
  try{response=await fetchWithAuth(`/api/ai/runs/${run.id}?after=${run.cursor}`,{headers:{'x-run-token':run.token},signal});if(!response.ok)throw new Error('读取后台任务失败');failures=0}
  catch(error){if(signal.aborted)throw error;if(++failures>=10)throw new Error('暂时无法读取后台任务；任务可能仍在运行，重新打开页面可继续获取。');await new Promise(r=>setTimeout(r,1500));continue}
  const page=await response.json()
  for(const item of page.events){onEvent(item.event);run.cursor=item.seq;save()}
  if(page.events.length===100)continue
  if(page.status!=='running'){
   if(page.status!=='completed')throw new Error(page.status==='interrupted'?'服务重启导致任务中断，已完成结果保留；请查询后继续，未重放未知写入。':'后台任务未完成，请查看回复。')
   return
  }
  await new Promise(r=>setTimeout(r,700))
 }
}
export async function cancelBackground(run:PendingRun){const r=await fetchWithAuth(`/api/ai/runs/${run.id}`,{method:'DELETE',headers:{'x-run-token':run.token}});if(!r.ok)throw new Error('停止任务失败')}
