import type { MarkerIconType } from '@/types/marker'
import { MARKER_ICONS } from '@/types/marker'

// Presentation only: stored icon types and emoji values remain unchanged.
export const PLACE_ICON_ASSETS: Readonly<Record<string, string>> = {
    '⛩️': '/icons/places/shrine.svg',
    '⛩': '/icons/places/shrine.svg',
    '🎯': '/icons/places/activity.svg',
    '📍': '/icons/places/location.svg',
    '🏨': '/icons/places/hotel.svg',
    '🛍️': '/icons/places/shopping.svg',
    '🛍': '/icons/places/shopping.svg',
    '🍜': '/icons/places/food.svg',
    '🌆': '/icons/places/landmark.svg',
    '🎡': '/icons/places/park.svg',
    '🗻': '/icons/places/natural.svg',
    '🚉': '/icons/places/transit.svg',
    '✈️': '/icons/places/plane.svg',
    '✈': '/icons/places/plane.svg',
    '📅': '/icons/places/calendar.svg',
    '🗺️': '/icons/places/map.svg',
    '🗺': '/icons/places/map.svg',
}

export function PlaceIcon({ iconType, emoji, size = 20, className }: {
    iconType?: MarkerIconType
    emoji?: string
    size?: number
    className?: string
}) {
    const value = emoji ?? (MARKER_ICONS[iconType || 'location'] || MARKER_ICONS.location).emoji
    const source = PLACE_ICON_ASSETS[value]
    return source
        ? <img src={source} width={size} height={size} alt="" aria-hidden="true" className={className} draggable={false} style={{ width: size, height: size, flexShrink: 0 }} />
        : <span aria-hidden="true" className={className}>{value}</span>
}
