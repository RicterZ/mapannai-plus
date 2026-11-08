// Isolated browser + Google OverlayView contract mock; no live SDK/key required.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { chromium } = require('playwright')
async function main() {
    const source = ts.transpileModule(fs.readFileSync('src/lib/map/google-map-sdk.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
    try {
        const page = await browser.newPage()
        await page.setContent('<div id="map" style="width:500px;height:500px"></div>')
        await page.evaluate(() => {
            window.exports = {}
            const isolateClicks = node => node.addEventListener('click', event => event.stopPropagation())
            class OverlayView {
                static preventMapHitsFrom(node) { isolateClicks(node) }
                static preventMapHitsAndGesturesFrom(node) {
                    isolateClicks(node)
                    for (const name of ['wheel', 'mousedown', 'touchstart']) node.addEventListener(name, event => event.stopPropagation())
                }
            }
            window.google = { maps: { Map: class {}, OverlayView } }
        })
        await page.addScriptTag({ content: source })
        await page.evaluate(async () => {
            const sdk = await window.exports.loadGoogleMap('fixture')
            const map = document.querySelector('#map')
            window.events = { wheel: 0, click: 0, markerClick: 0 }
            map.addEventListener('wheel', () => window.events.wheel++)
            map.addEventListener('click', () => window.events.click++)
            for (const [id, options] of [['marker', { bubble: true }], ['popup', {}], ['decorative', { clickable: false }]]) {
                const content = document.createElement('button')
                content.id = id; content.textContent = id
                content.addEventListener('click', () => window.events.markerClick++)
                const marker = new sdk.Marker({ content, position: [139, 35], ...options })
                marker.container.style.top = id === 'marker' ? '20px' : '80px'
                map.appendChild(marker.container)
            }
        })
        await page.locator('#marker').hover(); await page.mouse.wheel(0, -120)
        await page.waitForFunction(() => window.events.wheel === 1, null, { timeout: 5000 })
        await page.locator('#marker').click()
        await page.locator('#popup').hover(); await page.mouse.wheel(0, -120)
        await page.locator('#popup').click()
        assert.deepEqual(await page.evaluate(() => window.events), { wheel: 1, click: 0, markerClick: 2 })
        assert.equal(await page.locator('#decorative').evaluate(node => getComputedStyle(node.parentElement).pointerEvents), 'none')
        console.log('PASS: marker wheel reaches map; marker/popup clicks stay isolated; popup wheel stays isolated; decorative overlays stay transparent')
    } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
