import { NextRequest } from 'next/server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
async function proxy(request:NextRequest,{params}:{params:{path?:string[]}}){
    if(params.path?.some(part=>! /^[a-f0-9]{48}$/.test(part)))return new Response(null,{status:400})
    const token=request.headers.get('x-run-token') || ''
    if(!/^[a-zA-Z0-9-]{32,100}$/.test(token))return new Response(null,{status:400})
    const url=new URL('/runs'+(params.path?.length?'/'+params.path.join('/'):'') ,process.env.AGENT_URL || 'http://127.0.0.1:3100')
    url.search=request.nextUrl.search
    const body=request.method==='POST'?await request.text():undefined
    if(body && body.length>2000000)return new Response(null,{status:413})
    try{const response=await fetch(url,{method:request.method,headers:{'Content-Type':'application/json','x-run-token':token,...(process.env.AGENT_TOKEN?{Authorization:'Bearer '+process.env.AGENT_TOKEN}:{})},body,signal:AbortSignal.timeout(10000)})
        return new Response(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
    }catch{return new Response(null,{status:502})}
}
export {proxy as POST,proxy as GET,proxy as DELETE}
