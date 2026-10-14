export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { startMarkerAddressBackfill } = await import('./lib/db/marker-address-backfill')
        startMarkerAddressBackfill()
    }
}
