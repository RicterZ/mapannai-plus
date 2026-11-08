// Run after npm run build; uses the actual bundled Worker in an isolated browser.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { build } = require('esbuild')
const { chromium } = require('playwright')
async function main() {
    const chunks = path.resolve('.next/static/chunks')
    const workerFile = fs.readdirSync(chunks).find(file => file.endsWith('.js') && fs.readFileSync(path.join(chunks, file), 'utf8').includes('self.onmessage='))
    assert(workerFile, 'production build contains the separation Worker')
    const bundle = await build({ stdin: { contents: `
        import React, {act} from 'react'; import {createRoot} from 'react-dom/client';
        import {useSeparatedPaths} from './src/lib/map/use-separated-paths';
        function Harness({paths,zoom,tileSize=256}) { window.currentPaths=useSeparatedPaths(paths,zoom,tileSize); return null }
        const root=createRoot(document.getElementById('root'));
        window.render=async props=>{await act(async()=>root.render(React.createElement(Harness,props)))};
        window.unmount=async()=>{await act(async()=>root.unmount())};
        window.IS_REACT_ACT_ENVIRONMENT=true;
    `, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, platform: 'browser', plugins: [{ name: 'worker-url', setup(build) { build.onLoad({ filter: /use-separated-paths\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8').replace("new URL('./route-separation.worker.ts', import.meta.url)", "'/worker.js'"), loader: 'ts' })) } }] })
    const server = http.createServer((req, res) => {
        if (req.url === '/worker.js') { res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(chunks, workerFile))); return }
        if (req.url === '/harness.js') { res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents); return }
        res.end('<div id="root"></div><script src="/harness.js"></script>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
    try {
        const page = await browser.newPage()
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        const result = await page.evaluate(async () => {
            const paths=Array.from({length:200},(_,i)=>Array.from({length:65},(_,j)=>[139+j*.0001,35+Math.sin(j/64*Math.PI)*.001+(i%10)*.00001]))
            let ticks=0;const interval=setInterval(()=>ticks++,16)
            const started=performance.now()
            const separated=await new Promise((resolve,reject)=>{const worker=new Worker('/worker.js');worker.onmessage=e=>{worker.terminate();resolve(e.data)};worker.onerror=reject;worker.postMessage({paths,zoom:14,tileSize:256})})
            clearInterval(interval)
            const wait=()=>new Promise(resolve=>setTimeout(resolve,100))
            await window.render({paths:paths.slice(0,2),zoom:14});
            for(let i=0;i<50 && window.currentPaths[0].length===65;i++)await wait()
            const previous=window.currentPaths
            await window.render({paths:paths.slice(0,2),zoom:15})
            const retained=window.currentPaths===previous
            const changed=[[[1,2],[3,4]]]
            await window.render({paths:changed,zoom:15})
            await wait()
            const latest=JSON.stringify(window.currentPaths)===JSON.stringify(changed)
            await window.unmount()
            return { ticks, duration:Math.round(performance.now()-started), count:separated.length, endpoints:JSON.stringify([separated[0][0],separated[0].at(-1)]), expected:JSON.stringify([paths[0][0],paths[0].at(-1)]), retained,latest }
        })
        assert(result.ticks > 5, 'main thread remains responsive during heavy separation')
        assert.equal(result.count,200)
        const actual=JSON.parse(result.endpoints),expected=JSON.parse(result.expected)
        for(let i=0;i<2;i++)for(let j=0;j<2;j++)assert(Math.abs(actual[i][j]-expected[i][j])<1e-8)
        assert(result.retained, 'zoom changes retain previous lanes until worker replies')
        assert(result.latest, 'changed geometry cancels obsolete work and cannot adopt stale paths')
        console.log('PASS: production worker, responsive input thread, endpoints, old lanes during zoom, stale-job cancellation',result)
    } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)) }
}
main().catch(error=>{console.error(error);process.exitCode=1})
