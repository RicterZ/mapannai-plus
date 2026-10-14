import { getDb } from './index'
import { mapProviderFactory } from '@/lib/map/providers/map-provider-factory'
import { isInChina } from '@/lib/coord-transform'

const HOUR = 60 * 60 * 1000
const missingAddress = "(address IS NULL OR trim(address, char(9) || char(10) || char(13) || ' ') = '')"

/** Only fill an empty address if the marker still has the coordinates we queried. */
export async function backfillMarkerAddresses() {
    const db = getDb()
    const markers = db.prepare(`SELECT id, latitude, longitude FROM markers WHERE ${missingAddress}`).all() as {
        id: string; latitude: number; longitude: number
    }[]
    const update = db.prepare(`UPDATE markers SET address = ?, updated_at = ?
        WHERE id = ? AND latitude = ? AND longitude = ? AND ${missingAddress}`)
    for (const marker of markers) {
        const { latitude, longitude } = marker
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue
        const providers = isInChina(longitude, latitude) ? ['amap', 'google'] as const : ['google'] as const
        for (const provider of providers) {
            try {
                // DB and map-click inputs are WGS-84; only providers convert at the API boundary.
                const details = await mapProviderFactory.createProvider(provider).getPlaceDetails({ latitude, longitude })
                const address = details.address?.trim()
                if (!address || address === '未知地址' || address === '无法获取地址信息') continue
                update.run(address, new Date().toISOString(), marker.id, latitude, longitude)
                break
            } catch {
                // Never log provider errors: they may contain credentials or response bodies.
                console.warn('[marker-address-backfill] provider lookup failed:', provider)
            }
        }
        // Keep bulk reverse geocoding sequential and below the usual provider QPS limit.
        await new Promise(resolve => setTimeout(resolve, 350))
    }
}

export function startMarkerAddressBackfill() {
    const state = globalThis as typeof globalThis & { markerAddressBackfillStarted?: boolean }
    if (state.markerAddressBackfillStarted) return
    state.markerAddressBackfillStarted = true
    const run = async () => {
        try {
            await backfillMarkerAddresses()
        } catch {
            console.warn('[marker-address-backfill] scan failed')
        } finally {
            // Schedule after completion so a slow scan never overlaps the next one.
            setTimeout(run, HOUR).unref()
        }
    }
    void run()
}
