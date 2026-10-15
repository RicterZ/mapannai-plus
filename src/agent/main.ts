import 'dotenv/config'
import { createAgentServer } from './server'

const host = process.env.AGENT_HOST || '127.0.0.1'
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !process.env.AGENT_TOKEN) {
    throw new Error('AGENT_TOKEN is required for non-loopback binding')
}
const { server, wss } = createAgentServer()
server.listen(Number(process.env.AGENT_PORT || 3100), host, () => console.log(`MapAnNai Agent ready on ${(server.address() as { port: number }).port}`))
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => {
    wss.clients.forEach(socket => socket.terminate())
    wss.close()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5000).unref()
})
