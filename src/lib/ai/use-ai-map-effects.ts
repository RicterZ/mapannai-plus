'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { ChatMessage } from './protocol'

/** Interpret only live web-chat creation results; MCP and saved transcripts stay unchanged. */
export function createdMarkerIds(message: ChatMessage): string[] {
    if (message.role !== 'tool' || !['create_marker', 'plan_trip_day'].includes(message.name || '')) return []
    try {
        const result = JSON.parse(message.content)
        if (result.isError) return []
        const ids: string[] = []
        for (const part of result.content || []) {
            if (part.type !== 'text' || typeof part.text !== 'string') continue
            const data = JSON.parse(part.text)
            const places = Array.isArray(data) ? data : data.results
            if (!Array.isArray(places)) continue
            for (const place of places) {
                if (place.status === 'created' && typeof place.id === 'string') ids.push(place.id)
            }
        }
        return Array.from(new Set(ids))
    } catch { return [] }
}

export function useAiMapEffects({ enabled, refresh, onCreated }: {
    enabled: boolean
    refresh: () => Promise<void>
    onCreated: (ids: string[]) => void
}) {
    const options = useRef({ enabled, refresh, onCreated })
    options.current = { enabled, refresh, onCreated }
    const generation = useRef(0)
    useEffect(() => {
        generation.current++
        return () => { generation.current++ }
    }, [enabled])
    return useCallback((message: ChatMessage) => {
        const ids = createdMarkerIds(message)
        if (!ids.length || !options.current.enabled) return
        const current = ++generation.current
        void options.current.refresh().then(() => {
            if (current === generation.current && options.current.enabled) options.current.onCreated(ids)
        }).catch(() => {})
    }, [])
}
