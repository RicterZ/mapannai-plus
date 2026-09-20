/**
 * Stateless MCP Streamable HTTP endpoint.
 * Clients POST JSON-RPC messages directly to /api/mcp.
 */

import { NextRequest } from 'next/server'
import { createMcpServer } from '@/lib/mcp/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  const server = createMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}

// Stateless mode has neither a server event stream nor sessions to delete.
function methodNotAllowed(): Response {
  return Response.json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  }, { status: 405, headers: { Allow: 'POST' } })
}

export const GET = methodNotAllowed
export const DELETE = methodNotAllowed
