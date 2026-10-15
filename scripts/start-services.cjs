const { spawn } = require('node:child_process')

const env = {
    ...process.env,
    AGENT_HOST: '127.0.0.1',
    AGENT_URL: `http://127.0.0.1:${process.env.AGENT_PORT || 3100}`,
    AGENT_MCP_URL: `http://127.0.0.1:${process.env.PORT || 3000}/api/mcp`,
}
const children = [
    spawn(process.execPath, ['server.js'], { env, stdio: 'inherit' }),
    spawn(process.execPath, ['agent.cjs'], { env, stdio: 'inherit' }),
]
let stopping = false
let exitCode = 0
let timer
function stop(code) {
    if (stopping) return
    stopping = true
    exitCode = code
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
    // One failed process must restart the whole container, not leave a half-working service.
    timer = setTimeout(() => {
        for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
    }, 8000)
    timer.unref()
}
for (const child of children) {
    child.on('error', () => stop(1))
    child.on('exit', () => {
        if (!stopping) stop(1)
        if (children.every(item => item.exitCode !== null || item.signalCode !== null)) {
            clearTimeout(timer)
            process.exit(exitCode)
        }
    })
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))
