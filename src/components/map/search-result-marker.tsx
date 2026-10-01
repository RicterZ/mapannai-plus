'use client'

import React from 'react'
import type { SearchResult } from '@/lib/api/search-service'

export function searchResultKey(result: SearchResult): string {
    return result.placeId || `${result.name}:${result.coordinates.longitude},${result.coordinates.latitude}`
}

/** Temporary search overlays stay separate from saved markers and trip membership. */
export function SearchResultMarker({ result, selected, onClick }: {
    result: SearchResult; selected: boolean; onClick: () => void
}) {
    return <button
        type="button"
        aria-label={`搜索地点：${result.name}`}
        aria-pressed={selected}
        title={result.name}
        className="map-search-marker flex h-11 w-11 items-center justify-center touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full"
        onClick={event => { event.stopPropagation(); onClick() }}
        onDoubleClick={event => event.stopPropagation()}
    >
        <span className={`rounded-full border-2 border-white bg-blue-500 shadow-md transition-all duration-150 motion-reduce:transition-none ${selected ? 'h-4 w-4 ring-4 ring-blue-300/50' : 'h-3 w-3'}`} />
    </button>
}
