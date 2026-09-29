import { MapClient } from './map-client'

export const dynamic = 'force-dynamic'

export default function HomePage() {
    const renderer = process.env.MAP_RENDERER === 'amap' ? 'amap' : 'osm'
    return <MapClient renderer={renderer} amapJsKey={process.env.AMAP_JS_KEY || ''} amapSecurityCode={process.env.AMAP_JS_SECURITY_CODE || ''} routeProvider={process.env.MAP_DIRECTIONS_PROVIDER || 'google'} />
}
