'use client'

import React from 'react'

import { useMapStore } from '@/store/map-store'
import type { Marker } from '@/types/marker'

export function TripPlaceTitle({ marker, tripId }: { marker: Marker; tripId?: string }) {
    const title = useMapStore(state => state.trips.find(trip => trip.id === (tripId ?? state.activeView.tripId))?.markerNotes?.find(note => note.markerId === marker.id)?.title)
    const place = marker.content.title || '未命名地点'
    return <>{title || place}{title && title !== place && <span className="block text-xs font-normal leading-5 text-gray-500">{place}</span>}</>
}
