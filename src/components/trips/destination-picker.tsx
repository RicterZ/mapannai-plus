'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import type { TripDestination } from '@/types/trip'

export function DestinationPicker({ value, onChange }: { value: TripDestination[]; onChange: (value: TripDestination[]) => void }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<TripDestination[]>([])
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (!query.trim()) { setResults([]); setError(''); setLoading(false); return }
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
    }, [query])
    const selected = (result: TripDestination) => value.some(item => item.latitude.toFixed(6) === result.latitude.toFixed(6) && item.longitude.toFixed(6) === result.longitude.toFixed(6))
    return <div>
        <label htmlFor="trip-destination" className="block text-xs font-semibold text-gray-700 mb-1">目的地 *</label>
        <div className="flex flex-wrap items-center gap-1.5 w-full px-2 py-1.5 min-h-10 border border-gray-300 rounded-xl focus-within:ring-2 focus-within:ring-blue-500">
            {value.map((item, index) => <span key={`${item.longitude}:${item.latitude}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-blue-50 pl-2 text-xs text-blue-700">
                <span className="truncate" title={item.name}>{item.name}</span>
                <button type="button" aria-label={`移除目的地 ${item.name}`} onClick={() => onChange(value.filter((_, i) => i !== index))}
                    className="destination-tag-remove shrink-0 flex items-center justify-center rounded-lg hover:bg-blue-100">×</button>
            </span>)}
            <input ref={inputRef} id="trip-destination" type="text" value={query} placeholder={value.length ? '继续添加目的地' : '搜索省市，例如东京、重庆、巴黎'}
                autoComplete="off" maxLength={200} disabled={value.length >= 20}
                onChange={event => setQuery(event.target.value)}
                className="min-w-0 w-32 flex-1 py-1 px-1 text-sm outline-none bg-transparent" />
        </div>
        {loading && <p role="status" className="mt-1 text-xs text-gray-500">搜索中…</p>}
        {error && <p role="status" className="mt-1 text-xs text-gray-500">{error}</p>}
        {!!results.length && <ul aria-label="目的地搜索结果" className="mt-1 border border-gray-200 rounded-xl overflow-hidden">
            {results.map((result, index) => <li key={`${result.longitude}:${result.latitude}:${index}`}>
                <button type="button" disabled={selected(result) || value.length >= 20} className="w-full text-left px-3 py-2 min-h-[44px] text-sm hover:bg-blue-50 focus:bg-blue-50 disabled:opacity-40"
                    onClick={() => { onChange([...value, result]); setQuery(''); setResults([]); inputRef.current?.focus() }}>{result.name}</button>
            </li>)}
        </ul>}
    </div>
}
