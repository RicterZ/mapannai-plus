export class AgentStageError extends Error {
    constructor(public readonly stage: string, public readonly kind: string, message: string) { super(message); this.name = 'AgentStageError' }
}
export function agentErrorMessage(error: unknown): string {
    if (error instanceof AgentStageError) {
        console.warn('[agent-failure]', error.stage, error.kind)
        return error.message
    }
    console.warn('[agent-failure]', 'execution', error instanceof Error ? error.name : 'UnknownError')
    return 'Agent 执行失败；已保存的数据会保留，请查询后继续。'
}
