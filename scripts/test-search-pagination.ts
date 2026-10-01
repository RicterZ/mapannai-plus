import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { parseSearchPagination } from '../src/lib/map/search-pagination'
import { AmapServerProvider } from '../src/lib/map/providers/amap-server-provider'
import { GoogleServerProvider } from '../src/lib/map/providers/google-server-provider'
import { GET } from '../src/app/api/search/route'
import { mapProviderFactory } from '../src/lib/map/providers'

async function main() {
    const originalFetch = globalThis.fetch
    const originalProvider = process.env.MAP_SEARCH_PROVIDER
    let calls = 0
    const poi = (id: number) => ({ id: `poi-${id}`, name: `地点${id}`, location: '121.4,31.2', address: '上海' })
    try {
        for (const params of ['page=0', 'page=1.5', 'page=101', 'pageSize=26', 'pageSize=nope']) {
            assert.throws(() => parseSearchPagination(new URLSearchParams(params)))
        }
        assert.equal(parseSearchPagination(new URLSearchParams('limit=99')).limit, 20)
        assert.equal(parseSearchPagination(new URLSearchParams()).paginated, false)
        const amap = new AmapServerProvider()
        const abort = new AbortController()
        globalThis.fetch = async (input, init) => {
            const url = new URL(String(input)); calls++
            assert.equal(url.pathname, '/v3/place/polygon')
            assert.equal(url.searchParams.get('offset'), '20')
            assert.equal(init?.signal, abort.signal)
            const page = Number(url.searchParams.get('page'))
            const start = (page - 1) * 20, end = Math.min(start + 20, 45)
            return Response.json({ status: '1', count: '45', pois: Array.from({ length: Math.max(0, end - start) }, (_, i) => poi(i + start)) })
        }
        const bounds = { west: 121, east: 122, south: 31, north: 32 }
        const first = await amap.searchPlacesPage('咖啡', { accessToken: 'mock-only' }, 'CN', { page: 1, bounds, signal: abort.signal })
        const second = await amap.searchPlacesPage('咖啡', { accessToken: 'mock-only' }, 'CN', { page: 2, bounds, signal: abort.signal })
        const last = await amap.searchPlacesPage('咖啡', { accessToken: 'mock-only' }, 'CN', { page: 3, bounds, signal: abort.signal })
        assert.equal(first.results.length, 20); assert.equal(first.nextPage, 2)
        assert.equal(second.results[0].placeId, 'poi-20'); assert.equal(second.nextPage, 3)
        assert.equal(last.results.length, 5); assert.equal(last.hasMore, false); assert.equal(last.nextPage, null)
        assert.equal(first.total, 45); assert.equal(calls, 3)
        globalThis.fetch = async (input, init) => {
            const url = new URL(String(input)); assert.equal(init?.signal, abort.signal)
            const token = url.searchParams.get('pagetoken')
            return Response.json({ status: 'OK', results: [{ name: token ? '第二页' : '第一页', place_id: token ? 'g2' : 'g1', geometry: { location: { lat: 35, lng: 139 } } }], ...(token ? {} : { next_page_token: 'mock-next' }) })
        }
        const google = new GoogleServerProvider()
        const g1 = await google.searchPlacesPage('东京 咖啡', { accessToken: 'mock-only' }, 'JP', { pageSize: 5, signal: abort.signal })
        assert.equal(g1.pageSize, 20); assert.equal(g1.nextPageToken, 'mock-next')
        const g2 = await google.searchPlacesPage('东京 咖啡', { accessToken: 'mock-only' }, 'JP', { page: 2, pageToken: g1.nextPageToken, signal: abort.signal })
        assert.equal(g2.results[0].placeId, 'g2'); assert.equal(g2.hasMore, false)
        await assert.rejects(() => google.searchPlacesPage('东京', { accessToken: 'mock-only' }, 'JP', { page: 2 }))
        // Exercise the actual endpoint against provider mocks, not a production DB/API.
        process.env.MAP_SEARCH_PROVIDER = 'amap'
        globalThis.fetch = async (input) => {
            const url = new URL(String(input))
            assert.equal(url.searchParams.get('page'), '2')
            assert.equal(url.searchParams.get('offset'), '25')
            return Response.json({ status: '1', count: '30', pois: Array.from({ length: 5 }, (_, i) => poi(25 + i)) })
        }
        // Inject a provider instance with a dummy key; never load production credentials.
        const previous = mapProviderFactory.createServiceProvider
        mapProviderFactory.createServiceProvider = () => ({
            searchPlaces: (query, _config, country, options) => amap.searchPlaces(query, { accessToken: 'mock-only' }, country, options),
            searchPlacesPage: (query, _config, country, options) => amap.searchPlacesPage(query, { accessToken: 'mock-only' }, country, options),
            getPlaceDetails: (coords) => amap.getPlaceDetails(coords),
            getDirections: (origin, destination, mode) => amap.getDirections(origin, destination, mode),
        })
        try {
            const response = await GET(new NextRequest('http://localhost/api/search?q=咖啡&page=2&pageSize=25'))
            assert.equal(response.status, 200)
            const body = await response.json()
            assert.equal(body.data.length, 5); assert.equal(body.page, 2); assert.equal(body.pageSize, 25)
            assert.equal(body.hasMore, false); assert.equal(body.total, 30)
            globalThis.fetch = async () => Response.json({ status: '1', count: '20', pois: Array.from({ length: 20 }, (_, i) => poi(i)) })
            const legacy = await GET(new NextRequest('http://localhost/api/search?q=咖啡&limit=5'))
            const old = await legacy.json()
            assert.equal(old.data.length, 5); assert.equal(old.hasMore, undefined)
            const invalid = await GET(new NextRequest('http://localhost/api/search?q=咖啡&pageSize=999'))
            assert.equal(invalid.status, 400)
        } finally { mapProviderFactory.createServiceProvider = previous }
        console.log('Search pagination checks passed: AMap multi-page/final page, Google cursor, limits, cancellation signal and legacy endpoint.')
    } finally {
        globalThis.fetch = originalFetch
        if (originalProvider === undefined) delete process.env.MAP_SEARCH_PROVIDER
        else process.env.MAP_SEARCH_PROVIDER = originalProvider
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
