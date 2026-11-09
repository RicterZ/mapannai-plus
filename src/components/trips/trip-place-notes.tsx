'use client'

import React from 'react'
import { useMapStore } from '@/store/map-store'
import { compressedContentImages } from '@/lib/upload/image-url'
import type { Marker } from '@/types/marker'

export function TripPlaceNotes({ marker, tripId }: { marker: Marker; tripId: string | null }) {
    const trip = useMapStore(state => state.trips.find(trip => trip.id === tripId))
    const note = trip?.markerNotes?.find(note => note.markerId === marker.id)
    const content = trip ? note?.content || '' : marker.content.markdownContent || ''
    const body = content ? <div className="prose prose-sm max-w-none rich-content" dangerouslySetInnerHTML={{ __html: compressedContentImages(content) }} /> : null
    if (!trip) return <section className="space-y-3" aria-label="地点通用笔记">{body ?? <p className="text-xs text-gray-400">还没有通用笔记</p>}</section>
    return <section className="border-t border-gray-100 pt-3" aria-label="本次旅行笔记">
        <h3 className="py-1 text-sm font-medium leading-5 text-gray-800">行程笔记</h3>
        {note?.title || body ? <div className="mt-2 space-y-3">
            {note?.title && <h4 className="break-words text-lg font-semibold">{note.title}</h4>}
            {body}
        </div> : <p className="mt-0.5 text-xs leading-4 text-gray-400">这次旅行还没有笔记，可点右上角编辑添加</p>}
    </section>
}
