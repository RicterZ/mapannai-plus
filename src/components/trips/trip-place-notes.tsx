'use client'

import React from 'react'
import { useMapStore } from '@/store/map-store'
import { compressedContentImages } from '@/lib/upload/image-url'
import type { Marker } from '@/types/marker'

export function TripPlaceNotes({ marker, tripId }: { marker: Marker; tripId: string | null }) {
    const trip = useMapStore(state => state.trips.find(trip => trip.id === tripId))
    const note = trip?.markerNotes?.find(note => note.markerId === marker.id)
    const content = trip ? note?.content || '' : marker.content.markdownContent || ''
    return <section className="space-y-3" aria-label={trip ? '本次旅行笔记' : '地点通用笔记'}>
        <h3 className="text-xs font-medium text-gray-500">{trip ? `本次旅行 · ${trip.name}` : '地点通用笔记'}</h3>
        {note?.title && <h4 className="break-words text-lg font-semibold">{note.title}</h4>}
        {content ? <div className="prose prose-sm max-w-none rich-content" dangerouslySetInnerHTML={{ __html: compressedContentImages(content) }} /> : <p className="text-xs text-gray-400">{trip ? '还没有本次旅行笔记' : '还没有通用笔记'}</p>}
    </section>
}
