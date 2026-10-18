import type { Marker } from '@/types/marker'
import type { TransportMode } from '@/types/trip'

/**
 * Line style by arranged transport: flights are dashed with a heading plane, trains are always solid and
 * slightly heavier (track geometry is used when cached). `dashed: null` keeps the planning-state rule.
 */
export function routeLineStyle(mode?: TransportMode): { dashed: boolean | null; widthOffset: number; plane: boolean } {
    if (mode === 'flight') return { dashed: true, widthOffset: -1, plane: true }
    if (mode === 'train') return { dashed: false, widthOffset: 1, plane: false }
    return { dashed: null, widthOffset: 0, plane: false }
}

export const transportLabels: Record<TransportMode, string> = {
    walking: '步行', cycling: '骑行', driving: '驾车', taxi: '出租车', bus: '公交', subway: '地铁', train: '火车', flight: '飞机', ferry: '轮船', other: '其他',
}

export const planeIconSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path d="M21.5 12c0-.7-.6-1.2-1.3-1.2h-5.6L9.9 3.5H7.8l2.4 7.3H5.4L3.6 8.6H2l1.2 3.4L2 15.4h1.6l1.8-2.2h4.8l-2.4 7.3h2.1l4.7-7.3h5.6c.7 0 1.3-.5 1.3-1.2z" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke"/></svg>`

const colors = ['#526f5d', '#a86660', '#807398', '#517f85', '#9e7949', '#956f87', '#717c4b', '#627c96']
// Persisted palette slots keep adjacent days distinct and survive date edits.
export function routeColor(index: number, dayId?: string, colorIndex?: number): string {
    if (!dayId) return colors[index % colors.length]
    if (colorIndex !== undefined) {
        const base = colors[colorIndex % colors.length]
        const factor = [1, 0.8, 1.12, 0.9][index % 4]
        return '#' + [1, 3, 5].map(offset => Math.min(255, Math.round(parseInt(base.slice(offset, offset + 2), 16) * factor)).toString(16).padStart(2, '0')).join('')
    }
    let hash = 2166136261
    for (let i = 0; i < dayId.length; i++) hash = Math.imul(hash ^ dayId.charCodeAt(i), 16777619)
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
    hash ^= hash >>> 16
    const hue = (hash >>> 0) % 360
    const lightness = [0.42, 0.31, 0.51, 0.36, 0.46, 0.27][index % 6]
    const saturation = 0.38
    const a = saturation * Math.min(lightness, 1 - lightness)
    const channel = (n: number) => {
        const k = (n + hue / 30) % 12
        return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
    }
    return `#${channel(0)}${channel(8)}${channel(4)}`
}
export const dayColor = (dayId: string, colorIndex?: number): string => routeColor(0, dayId, colorIndex)

export function shortAddress(address?: string): string {
    return (address || '').replace(/^(中国|中华人民共和国|CN)[\s,]*/, '').replace(/\s*邮政编码[:：]?\s*\d+|\s*\b\d{6}\b/g, '').trim()
}

// Web Mercator bounds, with room for the sidebar and map controls.
export function routeCamera(markers: Marker[], width: number, height: number, tileSize = 256) {
    if (!markers.length) return null
    const xs = markers.map(m => (m.coordinates.longitude + 180) / 360)
    const ys = markers.map(m => {
        const latitude = Math.max(-85, Math.min(85, m.coordinates.latitude)) * Math.PI / 180
        return (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2
    })
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const zoom = Math.min(16, Math.log2(Math.max(120, width - 100) / (tileSize * Math.max(maxX - minX, 0.00001))), Math.log2(Math.max(120, height - 220) / (tileSize * Math.max(maxY - minY, 0.00001))))
    return { longitude: (minX + maxX) * 180 - 180, latitude: Math.atan(Math.sinh(Math.PI * (1 - minY - maxY))) * 180 / Math.PI, zoom: Math.max(2, zoom) }
}
