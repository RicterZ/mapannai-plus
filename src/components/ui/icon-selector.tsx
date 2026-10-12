'use client'

import { PlaceIcon } from '@/components/ui/place-icon'

import { MARKER_ICONS, type MarkerIconType } from '@/types/marker'
import { cn } from '@/utils/cn'

export function IconSelector({ selectedIcon = 'location', onSelect, className }: {
    selectedIcon?: MarkerIconType
    onSelect: (iconType: MarkerIconType) => void
    className?: string
}) {
    return <div role="group" aria-label="地点分类" className={cn('grid grid-cols-2 gap-1.5', className)}>
        {Object.entries(MARKER_ICONS).map(([type, icon]) => <button key={type} type="button" aria-pressed={selectedIcon === type} onClick={() => onSelect(type as MarkerIconType)} title={icon.description} className={cn('flex min-h-9 items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-300', selectedIcon === type ? 'border-accent-300 bg-accent-50 text-gray-900' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50')}>
            <PlaceIcon emoji={icon.emoji} size={20} /><span>{icon.name}</span>
        </button>)}
    </div>
}
