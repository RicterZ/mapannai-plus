import type { Marker } from '@/types/marker'

const colors = ['#2563eb', '#d97706', '#7c3aed', '#059669', '#db2777', '#0891b2']
export const routeColor = (index: number): string => colors[index % colors.length]

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
