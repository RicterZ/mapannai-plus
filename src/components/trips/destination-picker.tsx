'use client'

import { useEffect, useState } from 'react'
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import type { TripDestination } from '@/types/trip'

export function DestinationPicker({ value, onChange }: { value: TripDestination | null; onChange: (value: TripDestination | null) => void }) {
    const [query, setQuery] = useState(value?.name ?? '')
    const [results, setResults] = useState<TripDestination[]>([])
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    useEffect(() => {
        if (value || !query.trim()) { setResults([]); setError(''); setLoading(false); return }
        const controller = new AbortController()
        setResults([]); setError(''); setLoading(true)
        const timer = setTimeout(async () => {
            try {
                const response = await fetchWithAuth(`/api/destinations?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
                const body = await response.json()
                if (!response.ok) throw new Error(body.error || '搜索失败')
                if (controller.signal.aborted) return
                setResults(body.data)
                if (!body.data.length) setError('未找到省市，请尝试完整名称')
            } catch (error) {
                if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '搜索失败')
            } finally { if (!controller.signal.aborted) setLoading(false) }
        }, 400)
        return () => { clearTimeout(timer); controller.abort() }
    }, [query, value])
    return <div>
        <label htmlFor="trip-destination" className="block text-xs font-semibold text-gray-700 mb-1">目的地 *</label>
        <input id="trip-destination" type="text" value={query} placeholder="搜索省市，例如东京、重庆、巴黎"
            autoComplete="off" maxLength={200}
            onChange={event => { setQuery(event.target.value); onChange(null) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 h-10" />
        {!value && loading && <p role="status" className="mt-1 text-xs text-gray-500">搜索中…</p>}
        {!value && error && <p role="status" className="mt-1 text-xs text-gray-500">{error}</p>}
        {!!results.length && <ul aria-label="目的地搜索结果" className="mt-1 border border-gray-200 rounded-xl overflow-hidden">
            {results.map((result, index) => <li key={`${result.longitude}:${result.latitude}:${index}`}>
                <button type="button" className="w-full text-left px-3 py-2 min-h-[44px] text-sm hover:bg-blue-50 focus:bg-blue-50"
                    onClick={() => { onChange(result); setQuery(result.name); setResults([]) }}>{result.name}</button>
            </li>)}
        </ul>}
    </div>
}
