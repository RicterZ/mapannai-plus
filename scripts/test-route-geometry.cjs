// Run with node scripts/test-route-geometry.cjs; no SDK or live API required.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/lib/map/route-geometry.ts'), 'utf8')
const exportsObject = {}
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(exportsObject)
const { smoothRoutePath, layoutRoutePaths } = exportsObject
const p = (x, y) => ({ lng: x / 111000, lat: y / 111000 })
const length = points => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.lng - points[i].lng, point.lat - points[i].lat) * 111000, 0)
const circle = [p(-150, 0), p(-30, 0), p(-15, -20), p(0, -25), p(15, -20), p(30, 0), p(150, 0)]
assert.equal(smoothRoutePath(circle).length, 2, 'short traffic-circle excursion becomes a chord')
const semicircle = [p(-200, 0), p(-20, 0)]
for (let i = 1; i <= 12; i++) semicircle.push(p(-20 * Math.cos(Math.PI * i / 12), -20 * Math.sin(Math.PI * i / 12)))
semicircle.push(p(200, 0))
assert.equal(smoothRoutePath(semicircle).length, 2, 'semicircular roundabout becomes straight')
const closedCircle = [p(-1000, 0), p(0, 0), p(0, 25), p(25, 25), p(25, 0), p(0, 0), p(1000, 0)]
assert.equal(smoothRoutePath(closedCircle).length, 2, 'small mid-route circle is removed')
const distantLoop = [p(-1000, 0), p(0, 0), p(0, 120), p(120, 120), p(120, 0), p(10, 0), p(1000, 0)]
const distantDisplay = smoothRoutePath(distantLoop)
assert(length(distantDisplay) > 2300 && Math.max(...distantDisplay.map(point => point.lat * 111000)) >= 100, 'larger mid-route loop survives broader corner rounding')
const largeLoop = [p(0, 0), p(0, 400), p(400, 400), p(400, 0), p(10, 0), p(1000, 0)]
assert(length(smoothRoutePath(largeLoop)) > 2400, 'large waypoint detour survives')
const corner = [p(0, 0), p(0, 100), p(100, 100)]
assert(length(smoothRoutePath(corner)) > 180, 'major corner is rounded, not erased')
const needle = [p(-1000, 0), p(0, 0), p(30, 0), p(2, 1), p(1000, 20)]
const needleDisplay = smoothRoutePath(needle)
assert(length(needleDisplay) < length(needle) - 40, 'sparse short backtrack is pruned')
const hairpin = [p(0, 0), p(200, 0), p(20, 30)]
assert(smoothRoutePath(hairpin).length > 3, 'substantial reversal is rounded')
const outbound = [p(0, 0), p(100, 0), p(500, 0), p(1000, 0)]
const inbound = outbound.slice().reverse()
const snapshot = JSON.stringify([outbound, inbound])
const pair = [{ dayId: 'a', path: outbound }, { dayId: 'a', path: inbound }]
const displayed = layoutRoutePaths(pair)
assert(displayed[0].some(point => point.lat > 0), 'outbound bows to one side')
assert(displayed[1].some(point => point.lat < 0), 'inbound bows to the other side')
for (let i = 0; i < displayed.length; i++) {
    assert.equal(displayed[i][0], pair[i].path[0])
    assert.equal(displayed[i].at(-1), pair[i].path.at(-1))
    assert(displayed[i].every(point => Number.isFinite(point.lng) && Number.isFinite(point.lat)))
    assert(displayed[i].every(point => Math.abs(point.lat) * 111000 <= 90), 'bounded offset')
}
assert.equal(JSON.stringify([outbound, inbound]), snapshot, 'raw paths remain untouched')
assert.deepEqual(layoutRoutePaths(pair.slice().reverse()), displayed.slice().reverse(), 'layout independent of overlay order')
assert.deepEqual(layoutRoutePaths(pair), displayed, 'deterministic redraw')
assert.equal(smoothRoutePath(outbound), smoothRoutePath(outbound), 'smoothing cache reused')
const differentDays = layoutRoutePaths([{ dayId: 'a', path: outbound }, { dayId: 'b', path: inbound }])
assert.equal(differentDays[0], smoothRoutePath(outbound), 'different days do not displace each other')
const crossing = [p(500, -500), p(500, 500)]
assert.equal(layoutRoutePaths([{ dayId: 'a', path: outbound }, { dayId: 'a', path: crossing }])[0], smoothRoutePath(outbound), 'crossing is not a shared corridor')
assert.deepEqual(layoutRoutePaths([{ dayId: 'a', path: null }]), [null], 'pending route stays pending')
assert(smoothRoutePath([p(0, 0), p(0, 0), p(0, 0)]).every(point => Number.isFinite(point.lat)), 'duplicates stay finite')
console.log('PASS: traffic circles, major turns/loops, reciprocal separation, endpoints, bounded offsets, raw data, stable order, crossings, cache and pending routes')
