import type { SDKMapInstance, SDKMapNamespace, SDKPoint } from '@/components/map/sdk-map-renderer'

// Adapt Google's SDK primitives so both maps share React overlays and route presentation.
declare global { interface Window { google?: { maps: any }; mapannaiGoogleReady?: () => void; gm_authFailure?: () => void } }
let loader: Promise<SDKMapNamespace> | null = null

export function loadGoogleMap(apiKey: string): Promise<SDKMapNamespace> {
    if (window.google?.maps?.Map) return Promise.resolve(googleNamespace(window.google.maps))
    if (!loader) {
        loader = new Promise<SDKMapNamespace>((resolve, reject) => {
            const script = document.createElement('script')
            const timeout = window.setTimeout(() => fail(), 20000)
            const cleanup = () => { clearTimeout(timeout); delete window.mapannaiGoogleReady }
            const fail = () => { cleanup(); script.remove(); reject(new Error('Google 地图加载失败，请检查网络与地图 Key 配置')) }
            window.mapannaiGoogleReady = () => {
                cleanup()
                if (window.google?.maps?.Map) resolve(googleNamespace(window.google.maps))
                else fail()
            }
            window.gm_authFailure = () => { fail(); window.dispatchEvent(new Event('googleMapAuthError')) }
            script.async = true
            script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=mapannaiGoogleReady`
            script.onerror = fail
            document.head.appendChild(script)
        }).catch(error => { loader = null; throw error })
    }
    return loader!
}

// A light travel palette keeps saved places and itinerary colors in the foreground.
const travelMapStyles = [
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { elementType: 'geometry', stylers: [{ color: '#f7f8f5' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#536664' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d7e1dc' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#eef1ed' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e8efe5' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#ccead5' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#4b8063' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e2e8e2' }] },
    { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#fff6e9' }] },
    { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#f8d9ad' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#edc995' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#dae4e6' }] },
    { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#537985' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#b7e3ed' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4d8393' }] },
]

function googleNamespace(maps: any): SDKMapNamespace {
    const latLng = (point: number[]) => new maps.LatLng(point[1], point[0])
    const point = (value: any): SDKPoint => ({ getLng: () => value.lng(), getLat: () => value.lat() })
    const world = (position: number[]) => {
        const latitude = Math.max(-85, Math.min(85, position[1])) * Math.PI / 180
        return { x: (position[0] + 180) / 360, y: (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2 }
    }
    const fromWorld = (x: number, y: number) => [(x * 360 - 180 + 540) % 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI]
    class Pixel { constructor(public x: number, public y: number) {} }
    class MapInstance implements SDKMapInstance {
        native: any
        overlays = new Set<{ setMap(map: any): void }>()
        listeners = new Map<string, Map<(event: any) => void, any>>()
        projection: any
        frame: number | null = null
        moving = false
        constructor(container: HTMLElement, options: Record<string, any>) {
            this.native = new maps.Map(container, {
                center: latLng(options.center), zoom: options.zoom, styles: travelMapStyles,
                disableDefaultUI: true, gestureHandling: 'greedy',
                draggableCursor: 'default', draggingCursor: 'grabbing',
                disableDoubleClickZoom: true, heading: 0, tilt: 0, isFractionalZoomEnabled: true,
            })
            this.projection = new maps.OverlayView()
            this.projection.onAdd = () => {}
            this.projection.onRemove = () => {}
            this.projection.draw = () => {}
            this.projection.setMap(this.native)
            this.native.addListener('dragstart', () => this.cancelAnimation())
        }
        cancelAnimation() {
            if (this.frame !== null) cancelAnimationFrame(this.frame)
            this.frame = null
            this.moving = false
        }
        on(name: string, handler: (event: any) => void) {
            // A single settled camera event covers both panning and zooming.
            const event = name === 'moveend' ? 'idle' : name === 'zoomend' ? 'zoom_changed' : name
            const listener = this.native.addListener(event, (value: any) => {
                if (name === 'zoomend' || (name === 'moveend' && this.moving)) return
                handler(name === 'click' ? { lnglat: point(value.latLng), originEvent: value.domEvent } : value)
            })
            if (!this.listeners.has(name)) this.listeners.set(name, new Map())
            this.listeners.get(name)!.set(handler, listener)
        }
        off(name: string, handler: (event: any) => void) {
            this.listeners.get(name)?.get(handler)?.remove()
            this.listeners.get(name)?.delete(handler)
        }
        destroy() {
            this.cancelAnimation()
            this.overlays.forEach(overlay => overlay.setMap(null))
            this.overlays.clear()
            this.projection.setMap(null)
            maps.event.clearInstanceListeners(this.native)
            this.listeners.clear()
        }
        setZoomAndCenter(zoom: number, center: number[], immediately = false, duration = 700) {
            this.cancelAnimation()
            if (immediately || duration <= 0) { this.native.moveCamera({ center: latLng(center), zoom }); return }
            const initial = this.native.getCenter()
            const start = world([initial.lng(), initial.lat()]), end = world(center)
            let dx = end.x - start.x
            if (dx > .5) dx -= 1
            if (dx < -.5) dx += 1
            const startZoom = this.getZoom(), started = performance.now()
            this.moving = true
            const animate = (now: number) => {
                const t = Math.min(1, (now - started) / duration), eased = t * t * (3 - 2 * t)
                this.native.moveCamera({ center: latLng(fromWorld(start.x + dx * eased, start.y + (end.y - start.y) * eased)), zoom: startZoom + (zoom - startZoom) * eased })
                if (t < 1) this.frame = requestAnimationFrame(animate)
                else { this.frame = null; this.moving = false; maps.event.trigger(this.native, 'idle') }
            }
            this.frame = requestAnimationFrame(animate)
        }
        setCenter(center: number[]) { this.cancelAnimation(); this.native.setCenter(latLng(center)) }
        setZoom(zoom: number) { this.cancelAnimation(); this.native.setZoom(zoom) }
        getCenter() { return point(this.native.getCenter()) }
        getZoom() { return this.native.getZoom() ?? 12 }
        getBounds() {
            const bounds = this.native.getBounds()
            if (bounds) return { getSouthWest: () => point(bounds.getSouthWest()), getNorthEast: () => point(bounds.getNorthEast()) }
            // Before the first idle, estimate bounds from the same Mercator camera.
            const center = this.native.getCenter(), size = 256 * 2 ** this.getZoom()
            const w = world([center.lng(), center.lat()]), div = this.native.getDiv()
            return { getSouthWest: () => point(latLng(fromWorld(w.x - div.clientWidth / size / 2, w.y + div.clientHeight / size / 2))), getNorthEast: () => point(latLng(fromWorld(w.x + div.clientWidth / size / 2, w.y - div.clientHeight / size / 2))) }
        }
        lngLatToContainer(position: number[]) {
            const projected = this.projection.getProjection()?.fromLatLngToContainerPixel(latLng(position))
            if (projected) return { getX: () => projected.x, getY: () => projected.y }
            const center = this.native.getCenter(), a = world(position), b = world([center.lng(), center.lat()]), size = 256 * 2 ** this.getZoom(), div = this.native.getDiv()
            return { getX: () => div.clientWidth / 2 + (a.x - b.x) * size, getY: () => div.clientHeight / 2 + (a.y - b.y) * size }
        }
        add(overlays: Array<{ setMap(map: any): void }>) { overlays.forEach(overlay => { this.overlays.add(overlay); overlay.setMap(this.native) }) }
        remove(overlays: Array<{ setMap(map: any): void }>) { overlays.forEach(overlay => { overlay.setMap(null); this.overlays.delete(overlay) }) }
    }
    class Marker {
        overlay: any
        node: HTMLElement
        container: HTMLDivElement
        position: number[]
        offset: Pixel
        constructor(options: Record<string, any>) {
            this.node = options.content
            this.position = options.position
            this.offset = options.offset ?? new Pixel(0, 0)
            this.overlay = new maps.OverlayView()
            this.container = document.createElement('div')
            this.container.style.position = 'absolute'
            this.container.appendChild(this.node)
            this.setzIndex(options.zIndex ?? 100)
            if (options.clickable === false) this.container.style.pointerEvents = 'none'
            else maps.OverlayView.preventMapHitsAndGesturesFrom(this.container)
            this.overlay.onAdd = () => (options.clickable === false ? this.overlay.getPanes().overlayLayer : this.overlay.getPanes().overlayMouseTarget).appendChild(this.container)
            this.overlay.onRemove = () => this.container.remove()
            this.overlay.draw = () => {
                const pixel = this.overlay.getProjection()?.fromLatLngToDivPixel(latLng(this.position))
                if (pixel) { this.container.style.left = `${pixel.x + this.offset.x}px`; this.container.style.top = `${pixel.y + this.offset.y}px` }
            }
        }
        setMap(map: any) { this.overlay.setMap(map) }
        setPosition(position: number[]) { this.position = position; if (this.overlay.getMap()) this.overlay.draw() }
        setzIndex(index: number) { this.container.style.zIndex = String(index) }
        getContent() { return this.node }
    }
    class Polyline {
        native: any
        constructor(options: Record<string, any>) { this.native = new maps.Polyline(); this.setOptions(options) }
        setMap(map: any) { this.native.setMap(map) }
        setPath(path: number[][]) { this.native.setPath(path.map(latLng)) }
        setOptions(options: Record<string, any>) {
            const dashed = options.strokeStyle === 'dashed'
            this.native.setOptions({
                path: options.path.map(latLng), strokeColor: options.strokeColor,
                strokeWeight: options.strokeWeight, strokeOpacity: dashed ? 0 : options.strokeOpacity,
                zIndex: options.zIndex, clickable: options.strokeWeight === 28,
                icons: dashed ? [{ icon: { path: 'M 0,-4 0,4', scale: 1, strokeColor: options.strokeColor, strokeWeight: options.strokeWeight, strokeOpacity: options.strokeOpacity }, offset: '0', repeat: '14px' }] : [],
            })
        }
        on(name: string, handler: (event: any) => void) {
            this.native.addListener(name, (event: any) => handler({ lnglat: event.latLng ? point(event.latLng) : null, originEvent: event.domEvent }))
        }
    }
    return { Map: MapInstance, Marker, Polyline, Pixel }
}
