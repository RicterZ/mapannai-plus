import type { Trip, TripDay } from '@/types/trip'

export function placeMemberships(markerId: string, trips: Trip[], days: TripDay[]) {
    return trips.map(trip => ({ trip, days: days.filter(day => day.tripId === trip.id &&
        (day.markerIds.includes(markerId) || day.chains.some(chain => chain.includes(markerId))))
        .sort((a, b) => a.date.localeCompare(b.date)) }))
        .filter(({ trip, days }) => days.length || trip.markerIds?.includes(markerId) || trip.markerNotes?.some(note => note.markerId === markerId))
}
