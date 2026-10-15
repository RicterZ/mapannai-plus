import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export { readOnlyTools } from '../lib/ai/tool-policy'

export async function connectRemoteTools() {
    const client = new Client({ name: 'mapannai-agent', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(process.env.AGENT_MCP_URL || 'http://127.0.0.1:3000/api/mcp'), {
        requestInit: { headers: process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {} },
    })
    try {
        await client.connect(transport)
        const { tools } = await client.listTools()
        return {
            tools: tools.filter(tool => tool.name !== 'get_walking_directions').map(tool => ({ type: 'function' as const, function: {
                name: tool.name, description: tool.description, parameters: tool.inputSchema,
            } })),
            call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120_000 }),
            close: async () => { await client.close() },
        }
    } catch (error) { await client.close(); throw error }
}
