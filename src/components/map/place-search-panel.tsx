'use client'

import { PlaceIcon } from '@/components/ui/place-icon'

import React, { forwardRef, useEffect, useRef } from 'react'
import { ArrowLeft, Check, Loader2, Plus, Search, X } from 'lucide-react'
import type { MapSearchResult } from '@/lib/map/search-results'
import { searchResultKey } from './search-result-marker'
import { cn } from '@/utils/cn'

interface PlaceSearchPanelProps {
    open: boolean
    query: string
    results: MapSearchResult[]
    selectedKey: string | null
    busy: boolean
    addingKey: string | null
    error: string
    targetLabel: string | null
    isAdded: (result: MapSearchResult) => boolean
    onClose: () => void
    onQuery: (query: string) => void
    onSelect: (result: MapSearchResult) => void
    onAdd: (result: MapSearchResult) => void
}

export const PlaceSearchPanel = forwardRef<HTMLDivElement, PlaceSearchPanelProps>(function PlaceSearchPanel({ open, query, results, selectedKey, busy, addingKey, error, targetLabel, isAdded, onClose, onQuery, onSelect, onAdd }, ref) {
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (open && window.matchMedia('(min-width: 1024px)').matches) inputRef.current?.focus({ preventScroll: true })
    }, [open])
    if (!open) return null
    return <div ref={ref} className="place-search-panel flex min-h-0 flex-1 flex-col bg-white" role="region" aria-label="添加地点">
        <header className="flex items-start gap-3 px-5 pb-5 pt-6">
            <button type="button" onClick={onClose} aria-label="返回行程" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"><ArrowLeft size={18} /></button>
            <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-gray-900">添加地点</h2><p className="mt-1 truncate text-xs text-gray-500" title={targetLabel || '收藏地点'}>{targetLabel ? `添加到 · ${targetLabel}` : '收藏到我的地点'}</p></div>
        </header>
        <div className="px-5 pb-4">
            <div className="relative rounded-xl border border-gray-200 bg-gray-50 focus-within:border-accent-300 focus-within:ring-2 focus-within:ring-accent-100">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{busy ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}</span>
                <input ref={inputRef} aria-label="搜索地点" type="search" value={query} onChange={event => onQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } if (event.key === 'Enter' && results.length) onSelect(results[0]) }} placeholder="搜索地点名称" className="h-11 w-full rounded-xl bg-transparent pl-10 pr-11 text-sm outline-none placeholder:text-gray-400" />
                {query && <button type="button" aria-label="清空搜索" onClick={() => onQuery('')} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-gray-400 hover:text-gray-700"><X size={15} /></button>}
            </div>
        </div>
        <div className="place-search-results min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 custom-scrollbar" aria-busy={busy}>
            {results.map(result => {
                const key = searchResultKey(result), added = isAdded(result)
                return <div key={key} className={cn('mb-1 flex items-center gap-1 rounded-xl border border-transparent transition-colors', selectedKey === key ? 'border-accent-100 bg-accent-50/70' : 'hover:bg-gray-50')}>
                    <button type="button" aria-pressed={selectedKey === key} onClick={() => onSelect(result)} className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3.5 text-left">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-accent-500">{result.markerId ? <PlaceIcon iconType={result.iconType || 'location'} size={24} /> : <Search size={16} />}</span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-medium leading-5 text-gray-900">{result.name}</span>{result.address && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-gray-500">{result.address}</span>}{result.markerId && <span className="mt-1 block text-[11px] text-gray-400">已收藏</span>}</span>
                    </button>
                    <button type="button" disabled={added || addingKey !== null} onClick={() => onAdd(result)} aria-label={added ? `${result.name}已添加` : `添加${result.name}`} title={added ? '已添加' : '添加地点'} className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-600 hover:bg-accent-100 disabled:bg-transparent disabled:text-gray-400">{addingKey === key ? <Loader2 size={17} className="animate-spin" /> : added ? <Check size={17} /> : <Plus size={17} />}</button>
                </div>
            })}
            {!results.length && <div role="status" className="flex flex-col items-center px-5 py-12 text-center"><Search size={28} strokeWidth={1.25} className="mb-4 text-gray-300" /><p className="text-sm text-gray-500">{busy ? '搜索中…' : !query.trim() ? '找一找想去的地方' : query.trim().length < 2 ? '输入至少两个字搜索附近地点' : error ? '暂时无法获取搜索结果' : '没有找到相关地点'}</p></div>}
            {error && <p role="status" className="px-3 py-3 text-xs text-red-600">{error}</p>}
        </div>
    </div>
})
