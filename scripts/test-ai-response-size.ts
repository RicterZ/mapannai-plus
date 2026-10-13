import assert from 'node:assert/strict'
import { readCompletion } from '../src/lib/ai/completions'
import { compactWebText } from '../src/lib/mcp/tools/web-tools'
const signal = new AbortController().signal
const frame = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
const response = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
async function main() {
 const noisy = Array.from({length: 2500}, () => frame({reasoning_content: 'x'.repeat(1000)})).join('')
 const result = await readCompletion(response(noisy + frame({content:'短回复'}) + 'data: [DONE]\n\n'), () => {}, signal)
 assert.equal(result.content, '短回复', 'protocol/reasoning overhead must not trip the old 2 MB limit')
 await assert.rejects(() => readCompletion(response(frame({content:'x'.repeat(1_000_001)})),()=>{},signal), /正文或工具参数过长/)
 const call = {index:0,id:'call',function:{name:'create_marker',arguments:'{"name":"东京 浅草寺"}'}}
 const tools = await readCompletion(response(frame({tool_calls:[call]})+'data: [DONE]\n\n'),()=>{},signal)
 assert.equal(tools.tool_calls?.[0].function.arguments, call.function.arguments)
 assert.deepEqual(JSON.parse(compactWebText(JSON.stringify({data:{markdown:'正文',metadata:{title:'官网',sourceURL:'https://example.com'},html:'discard'}}),'firecrawl_scrape')), {title:'官网',url:'https://example.com',markdown:'正文'})
 assert.equal(compactWebText('plain markdown','firecrawl_scrape'),'plain markdown')
 console.log('Response size and web compaction checks passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
