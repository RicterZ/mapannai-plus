// In-process harness retained for existing isolated tests; production HTTP uses agent-proxy.
import { runPlanner as runAgent } from '@/agent/planner'
import { connectPlanningTools } from './mcp-tools'
import { attachTripContext } from './trip-context'
import type { ChatRequest, ChatEvent } from './protocol'
import type { requestCompletion } from './endpoint'

export async function runPlanner(request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal,
    deps: { connect?: typeof connectPlanningTools; complete?: typeof requestCompletion } = {}) {
    return runAgent(request, emit, signal,
        { connect: deps.connect || connectPlanningTools, complete: deps.complete, assess: async () => undefined, context: history => attachTripContext(history, request.context) })
}
