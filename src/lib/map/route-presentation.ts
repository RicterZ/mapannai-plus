import type { Marker } from '@/types/marker'

const colors = ['#1d4ed8', '#be123c', '#7e22ce', '#007d73', '#c2410c', '#a21caf', '#334155', '#0369a1']
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
    const saturation = 0.72
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
export function routeCamera(markers: Marker[], width: number, height: number) {
    if (!markers.length) return null
    const xs = markers.map(m => (m.coordinates.longitude + 180) / 360)
    const ys = markers.map(m => {
        const latitude = Math.max(-85, Math.min(85, m.coordinates.latitude)) * Math.PI / 180
        return (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2
    })
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const zoom = Math.min(16, Math.log2(Math.max(120, width - 100) / (256 * Math.max(maxX - minX, 0.00001))), Math.log2(Math.max(120, height - 220) / (256 * Math.max(maxY - minY, 0.00001))))
    return { longitude: (minX + maxX) * 180 - 180, latitude: Math.atan(Math.sinh(Math.PI * (1 - minY - maxY))) * 180 / Math.PI, zoom: Math.max(2, zoom) }
}
