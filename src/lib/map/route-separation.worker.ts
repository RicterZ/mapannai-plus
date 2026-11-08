import { separateOverlappingPaths } from './route-separation'

self.onmessage = (event: MessageEvent<{ paths: number[][][]; zoom: number; tileSize: number }>) => {
    const { paths, zoom, tileSize } = event.data
    self.postMessage(separateOverlappingPaths(paths, zoom, tileSize, { spacing: 5.5 }))
}
