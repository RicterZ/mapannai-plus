import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '@/lib/mcp/server'

/** Use the public MCP protocol in-process, retaining its schemas and service rules. */
export async function connectPlanningTools() {
    const server = createMcpServer()
    const client = new Client({ name: 'mapannai-web-ai', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const close = async () => { await Promise.allSettled([client.close(), server.close()]) }
    try {
        await server.connect(serverTransport)
        await client.connect(clientTransport)
        const { tools } = await client.listTools()
        return {
            tools: tools.filter(tool => tool.name !== 'get_walking_directions').map(tool => ({ type: 'function' as const, function: {
                name: tool.name, description: tool.description, parameters: tool.inputSchema,
            } })),
            call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120_000 }),
            close,
        }
    } catch (error) { await close(); throw error }
}

export const readOnlyTools = new Set(['list_markers', 'list_trips', 'get_trip_detail', 'search_places', 'get_place_details', 'get_directions', 'get_walking_directions'])
