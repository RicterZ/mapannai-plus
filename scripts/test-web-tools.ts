import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerWebTools } from '../src/lib/mcp/tools/web-tools'
async function main() {
 const server = new McpServer({name:'test',version:'1'})
 const client = new Client({name:'test',version:'1'})
 server.registerTool('baseline', {}, async()=>({content:[]}))
 delete process.env.BRAVE_API_KEY; delete process.env.FIRECRAWL_API_KEY
 registerWebTools(server)
 const [a,b] = InMemoryTransport.createLinkedPair()
 await server.connect(b); await client.connect(a)
 try {
  assert.equal((await client.listTools()).tools.length,1)
  process.env.BRAVE_API_KEY='mock'; process.env.FIRECRAWL_API_KEY='mock'
  registerWebTools(server)
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['baseline','fetch_web','search_web'])
  for(const url of ['file:///etc/passwd','https://user:pass@example.com','https://example.com:8080']) assert.equal((await client.callTool({name:'fetch_web',arguments:{url}})).isError,true)
  console.log('Web tool registration and URL validation passed')
 } finally {await client.close();await server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
