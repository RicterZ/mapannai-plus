import assert from 'node:assert/strict'
import { regionalRenderer, visibleMapCenter } from '../src/lib/map/regional-renderer'
import { isInChina } from '../src/lib/coord-transform'

const camera = { longitude: 120, latitude: 36, zoom: 5 }
assert.equal(regionalRenderer('amap', camera), 'amap')
const visible = visibleMapCenter(camera, 'google', [200, 0])
assert(visible.longitude > 128)
assert.equal(regionalRenderer('amap', visible), 'google', 'sidebar-visible center overseas must keep Google even when China is visible')
const foreign = { longitude: 126, latitude: 36, zoom: 5 }
assert.equal(regionalRenderer('amap', foreign), 'google')
const china = visibleMapCenter(foreign, 'google', [-210, 0])
assert(isInChina(china.longitude, china.latitude))
assert.equal(regionalRenderer('amap', china), 'amap')
for (const renderer of ['amap', 'google'] as const) {
    const center = { longitude: 116.4, latitude: 39.9, zoom: 10 }
    const result = visibleMapCenter(center, renderer, [0, 0])
    assert(Math.abs(result.longitude - center.longitude) < 0.00001)
    assert(Math.abs(result.latitude - center.latitude) < 0.00001)
}
assert.equal(regionalRenderer('osm', china), 'osm')
assert(visibleMapCenter({ longitude: 179, latitude: 35, zoom: 2 }, 'google', [200, 0]).longitude < 0)
console.log('Regional renderer checks passed: visible center only, sidebar offsets, WGS-84 conversion, longitude wrapping, fixed OSM')
