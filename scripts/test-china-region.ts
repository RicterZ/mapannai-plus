import assert from 'node:assert/strict'
import { isInChina, wgs84ToGcj02, gcj02ToWgs84 } from '../src/lib/coord-transform'
for (const [name, lng, lat] of [
    ['Beijing',116.4,39.9], ['Shanghai',121.47,31.23], ['Guangzhou',113.26,23.13],
    ['Xiamen',118.09,24.48], ['Sanya',109.51,18.25], ['Hong Kong',114.17,22.32],
    ['Macao',113.54,22.20], ['Urumqi',87.62,43.83], ['Lhasa',91.13,29.66],
] as const) {
    assert(isInChina(lng,lat), name)
    const converted = wgs84ToGcj02(lng,lat)
    assert(Math.abs(converted.longitude-lng)>0.00001, name)
    const restored = gcj02ToWgs84(converted.longitude,converted.latitude)
    assert(Math.abs(restored.longitude-lng)<0.0001 && Math.abs(restored.latitude-lat)<0.0001, name)
}
for (const [name,lng,lat] of [
    ['Hiroshima',132.4553,34.3853], ['Seoul',126.978,37.5665], ['Busan',129.0756,35.1796],
    ['Jeju',126.53,33.50], ['Tokyo',139.69,35.69], ['Taipei',121.56,25.03],
    ['Hanoi',105.83,21.03], ['Vladivostok',131.89,43.12],
] as const) {
    assert(!isInChina(lng,lat),name)
    assert.deepEqual(wgs84ToGcj02(lng,lat),{longitude:lng,latitude:lat},name)
    assert.deepEqual(gcj02ToWgs84(lng,lat),{longitude:lng,latitude:lat},name)
}
assert(isInChina(79.4462,49.2204),'inclusive region boundary')
assert(!isInChina(119.921265,25.398623),'inclusive exclusion boundary')
assert(!isInChina(NaN,35)); assert(!isInChina(116,Infinity))
assert(!isInChina(125.76,39.04),'Pyongyang is excluded')
assert(isInChina(125.75,41.0),'known approximation: some northern Korean locations remain included')
console.log('China region checks passed: shared rectangles, exclusions, conversion and round trips, inclusive boundaries, known approximation')
