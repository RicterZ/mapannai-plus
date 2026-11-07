'use client'

import React from 'react'
import { useMapStore } from '@/store/map-store'
import { placeImage } from '@/lib/trips/place-image'
import { compressedImageUrl } from '@/lib/upload/image-url'
import type { Marker } from '@/types/marker'

export function PlaceCover({ marker, tripId, className, fallback = null }: { marker: Marker; tripId?: string | null; className?: string; fallback?: React.ReactNode }) {
    const trips = useMapStore(state => state.trips)
    const activeTrip = useMapStore(state => state.activeView.tripId)
    const source = placeImage(marker, trips, tripId === undefined ? activeTrip : tripId)
    return source ? <img src={compressedImageUrl(source)} alt={`${marker.content.title || '地点'}封面`} loading="lazy" className={className} /> : <>{fallback}</>
}
