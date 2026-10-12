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
    '🚞': '/icons/trips/railway.svg',
    '🚢': '/icons/trips/ship.svg',
    '🚗': '/icons/trips/car.svg',
    '🏍️': '/icons/trips/motorcycle.svg',
    '🏕️': '/icons/trips/camping.svg',
    '🏖️': '/icons/trips/beach.svg',
    '🏯': '/icons/trips/japanese-castle.svg',
    '🎒': '/icons/trips/backpack.svg',
    '🍣': '/icons/trips/sushi.svg',
    '🍲': '/icons/trips/hot-pot.svg',
    '🍛': '/icons/trips/curry.svg',
    '🍖': '/icons/trips/meat.svg',
    '🚲': '/icons/trips/bicycle.svg',
    '🚐': '/icons/trips/van.svg',
    '⛵': '/icons/trips/sailboat.svg',
    '🚠': '/icons/trips/cable-car.svg',
    '🎈': '/icons/trips/balloon.svg',
    '🏜️': '/icons/trips/desert.svg',
    '🌋': '/icons/trips/volcano.svg',
    '🏝️': '/icons/trips/island.svg',
    '🌌': '/icons/trips/night-sky.svg',
    '🌸': '/icons/trips/blossom.svg',
    '🏰': '/icons/trips/castle.svg',
    '🗼': '/icons/trips/tower.svg',
    '🕌': '/icons/trips/mosque.svg',
    '🗽': '/icons/trips/statue-liberty.svg',
    '🎿': '/icons/trips/ski.svg',
    '🤿': '/icons/trips/diving.svg',
    '🏄': '/icons/trips/surf.svg',
    '🥾': '/icons/trips/hiking-boot.svg',
    '♨️': '/icons/trips/hot-spring.svg',
    '🎭': '/icons/trips/theatre.svg',
    '🎨': '/icons/trips/art.svg',
    '🎪': '/icons/trips/circus.svg',
    '🎶': '/icons/trips/music.svg',
    '🐼': '/icons/trips/panda.svg',
    '🐘': '/icons/trips/elephant.svg',
    '🐋': '/icons/trips/whale.svg',
    '🦒': '/icons/trips/giraffe.svg',
    '🐧': '/icons/trips/penguin.svg',
    '☕': '/icons/trips/coffee.svg',
    '🍷': '/icons/trips/wine.svg',
    '🍺': '/icons/trips/beer.svg',
    '🥐': '/icons/trips/croissant.svg',
    '🍕': '/icons/trips/pizza.svg',
    '🇨🇳': '/icons/trips/flag-cn.svg',
    '🇯🇵': '/icons/trips/flag-jp.svg',
    '🇰🇷': '/icons/trips/flag-kr.svg',
    '🇸🇬': '/icons/trips/flag-sg.svg',
    '🇹🇭': '/icons/trips/flag-th.svg',
    '🇺🇸': '/icons/trips/flag-us.svg',
    '🇫🇷': '/icons/trips/flag-fr.svg',
    '🇬🇧': '/icons/trips/flag-gb.svg',
    '🇮🇹': '/icons/trips/flag-it.svg',
    '🇩🇪': '/icons/trips/flag-de.svg',
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
