import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { callWebTool, registerWebTools } from '../src/lib/mcp/tools/web-tools'

async function main() {
  const calls: Array<{ name: string; args: unknown }> = []
  const http = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    const upstream = new McpServer({ name: 'mock-web', version: '1' })
    upstream.registerTool('brave_web_search', {
      inputSchema: { query: z.string(), count: z.number(), result_filter: z.array(z.string()) },
    }, async args => {
      calls.push({ name: 'brave_web_search', args })
      return { content: [{ type: 'text', text: JSON.stringify({ title: 'Official site', url: 'https://example.com', description: 'Snippet' }) }] }
    })
    upstream.registerTool('firecrawl_scrape', {
      inputSchema: { url: z.string(), formats: z.array(z.string()), onlyMainContent: z.boolean() },
    }, async args => {
      calls.push({ name: 'firecrawl_scrape', args })
      if (args.url.endsWith('/error')) return { isError: true, content: [{ type: 'text', text: 'secret-upstream-key' }] }
      return { content: [{ type: 'text', text: 'a'.repeat(30_000) }, { type: 'image', data: 'ignored', mimeType: 'image/png' }] }
    })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    try {
      await upstream.connect(transport)
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const response = await transport.handleRequest(new Request(`http://${req.headers.host}/mcp`, {
        method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks),
      }))
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      res.end(await response.text())
    } finally { await upstream.close() }
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`
  const keys = ['BRAVE_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_MCP_URL', 'FIRECRAWL_MCP_URL'] as const
  const old = keys.map(key => process.env[key])
  const client = new Client({ name: 'test', version: '1' })
  const server = new McpServer({ name: 'test', version: '1' })
  server.registerTool('baseline', {}, async () => ({ content: [] }))
  try {
    keys.forEach(key => delete process.env[key])
    registerWebTools(server)
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(b)
    await client.connect(a)
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['baseline'])
    process.env.BRAVE_API_KEY = process.env.FIRECRAWL_API_KEY = 'mock-only'
    process.env.BRAVE_MCP_URL = process.env.FIRECRAWL_MCP_URL = endpoint
    registerWebTools(server)
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['baseline', 'fetch_web', 'search_web'])
    const search = await client.callTool({ name: 'search_web', arguments: { query: 'official hours' } })
    assert.match(JSON.stringify(search), /Official site/)
    assert.deepEqual(calls[0], { name: 'brave_web_search', args: { query: 'official hours', count: 5, result_filter: ['web'] } })
    const page = await client.callTool({ name: 'fetch_web', arguments: { url: 'https://example.com' } })
    assert.match(JSON.stringify(page), /Content truncated/)
    assert.equal((page.content as Array<{ type: string }>).length, 1)
    assert.deepEqual(calls[1], { name: 'firecrawl_scrape', args: { url: 'https://example.com', formats: ['markdown'], onlyMainContent: true } })
    for (const url of ['file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com:8080']) {
      const invalid = await client.callTool({ name: 'fetch_web', arguments: { url } })
      assert.equal(invalid.isError, true)
    }
    const failed = await client.callTool({ name: 'fetch_web', arguments: { url: 'https://example.com/error' } })
    assert.equal(failed.isError, true)
    assert.doesNotMatch(JSON.stringify(failed), /secret-upstream-key/)
    const aborted = new AbortController()
    aborted.abort()
    assert.equal((await callWebTool(endpoint, 'firecrawl_scrape', {}, aborted.signal)).isError, true)
    assert.equal((await callWebTool('file:///tmp/no', 'firecrawl_scrape', {}, new AbortController().signal)).isError, true)
    console.log('Web tools: registration, forwarding, validation, truncation, error redaction and cancellation passed.')
  } finally {
    keys.forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i] })
    await Promise.allSettled([client.close(), server.close()])
    await new Promise<void>(resolve => http.close(() => resolve()))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
