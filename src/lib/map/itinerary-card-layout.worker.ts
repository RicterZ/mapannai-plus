import { layoutItineraryCards, type MapCardAnchor, type MapCardPlacement } from './itinerary-card-layout'

type Point = { x: number; y: number }
type Bounds = { left: number; top: number; right: number; bottom: number }

self.onmessage = (event: MessageEvent<{ anchors: MapCardAnchor[]; bounds: Bounds; paths: Point[][]; previous: MapCardPlacement[] }>) => {
    const { anchors, bounds, paths, previous } = event.data
    self.postMessage(layoutItineraryCards(anchors, bounds, paths, previous))
}
