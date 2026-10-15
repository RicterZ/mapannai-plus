const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

async function run(crash) {
    const dir = mkdtempSync(path.join(tmpdir(), 'mapannai-supervisor-'))
    const fixture = `console.log('ready'); process.on('SIGTERM',()=>{console.log('stopped');process.exit(0)}); setInterval(()=>{},1000);`
    writeFileSync(path.join(dir, 'server.js'), fixture)
    writeFileSync(path.join(dir, 'agent.cjs'), crash ? `setTimeout(()=>process.exit(2),200)` : fixture)
    const child = spawn(process.execPath, [path.join(__dirname, 'start-services.cjs')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const exited = once(child, 'exit')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    try {
        if (!crash) await new Promise(resolve => child.stdout.on('data', chunk => {
            output += chunk
            if ((output.match(/ready/g) || []).length === 2) { child.kill('SIGTERM'); resolve() }
        }))
        else child.stdout.on('data', chunk => { output += chunk })
        const [code, signal] = await exited
        assert.equal(signal, null)
        assert.equal(code, crash ? 1 : 0)
        assert.equal((output.match(/stopped/g) || []).length, crash ? 1 : 2)
    } finally { clearTimeout(timeout); child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }) }
}
(async () => { await run(false); await run(true); console.log('Unified container supervisor: graceful shutdown and sibling failure passed') })().catch(error => { console.error(error); process.exitCode = 1 })
