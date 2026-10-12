import assert from 'node:assert/strict'
import { routeCamera } from '../src/lib/map/route-presentation'
import type { Marker } from '../src/types/marker'

const places = [{ longitude: 139.692, latitude: 35.69 }, { longitude: 139.79, latitude: 35.71 }, { longitude: 139.772, latitude: 35.722 }].map((coordinates, index) => ({ id: String(index), coordinates, content: { id: String(index), markdownContent: '', createdAt: new Date(), updatedAt: new Date() } })) satisfies Marker[]
const y = (latitude: number) => (1 - Math.log(Math.tan(latitude * Math.PI / 180) + 1 / Math.cos(latitude * Math.PI / 180)) / Math.PI) / 2
for (const viewportWidth of [1280, 1440]) for (const tileSize of [256, 512]) {
    const sidebar = 400, height = 800, width = viewportWidth - sidebar
    const camera = routeCamera(places, width, height, tileSize)!
    const scale = tileSize * 2 ** camera.zoom
    for (const marker of places) {
        const px = sidebar + width / 2 + (marker.coordinates.longitude - camera.longitude) / 360 * scale
        const py = height / 2 + (y(marker.coordinates.latitude) - y(camera.latitude)) * scale
        assert.ok(px >= sidebar + 49 && px <= viewportWidth - 49, `Place is outside unobscured map: ${px}`)
        assert.ok(py >= 109 && py <= height - 109)
    }
    assert.equal(routeCamera(places, width, height, 256)!.zoom - routeCamera(places, width, height, 512)!.zoom, 1)
}
assert.equal(routeCamera([], 800, 800), null)
console.log('Workspace cameras fit all places beside the 400px sidebar at both desktop widths and renderer tile sizes.')
