import type { PlaceReferences } from './place-references'

export interface MarkerCoordinates {
    latitude: number
    longitude: number
}

// 图标类型定义
export type MarkerIconType =
    | 'activity'      // 🎯 活动
    | 'location'      // 📍 位置
    | 'hotel'         // 🏨 酒店
    | 'shopping'      // 🛍️ 购物
    | 'food'          // 🍜 美食
    | 'landmark'      // 🌆 地标建筑
    | 'park'          // 🎡 游乐场
    | 'natural'       // 🗻 自然景观
    | 'culture'       // ⛩️ 人文景观
    | 'transit'       // 🚉 交通

// 图标配置
export const MARKER_ICONS: Record<MarkerIconType, { name: string; emoji: string; description: string; bgClass: string; hoverBgClass: string }> = {
    activity: { name: '活动', emoji: '🎯', description: '活动和娱乐场所', bgClass: 'bg-orange-500/75', hoverBgClass: 'hover:bg-orange-500' },
    location: { name: '位置', emoji: '📍', description: '一般地点标记', bgClass: 'bg-pink-500/75', hoverBgClass: 'hover:bg-pink-500' },
    hotel: { name: '酒店', emoji: '🏨', description: '住宿和酒店', bgClass: 'bg-green-500/75', hoverBgClass: 'hover:bg-green-500' },
    shopping: { name: '购物', emoji: '🛍️', description: '购物中心和商店', bgClass: 'bg-purple-500/75', hoverBgClass: 'hover:bg-purple-500' },
    food: { name: '美食', emoji: '🍜', description: '美食和小吃', bgClass: 'bg-zinc-500/75', hoverBgClass: 'hover:bg-zinc-500' },
    landmark: { name: '地标', emoji: '🌆', description: '地标性建筑和知名地点', bgClass: 'bg-purple-500/75', hoverBgClass: 'hover:bg-purple-500' },
    park: { name: '游乐场', emoji: '🎡', description: '公园和游乐场', bgClass: 'bg-slate-500/75', hoverBgClass: 'hover:bg-slate-500' },
    natural: { name: '自然景观', emoji: '🗻', description: '自然景观', bgClass: 'bg-fuchsia-500/75', hoverBgClass: 'hover:bg-fuchsia-500' },
    culture: { name: '人文景观', emoji: '⛩️', description: '人文景观', bgClass: 'bg-gray-500/75', hoverBgClass: 'hover:bg-gray-500' },
    transit: { name: '交通', emoji: '🚉', description: '车站、机场、港口等交通枢纽', bgClass: 'bg-blue-500/75', hoverBgClass: 'hover:bg-blue-500' },
}

export interface MarkerContent {
    id: string
    title?: string // 地点名称
    address?: string // 地址
    headerImage?: string // 首图URL
    iconType?: MarkerIconType // 图标类型
    markdownContent: string // Markdown内容
    createdAt: Date
    updatedAt: Date
    // 临时标记相关字段
    isTemporary?: boolean // 是否为临时标记
    syncError?: string // 同步错误信息
}

export interface Marker {
    placeReferences?: PlaceReferences | null
    id: string
    coordinates: MarkerCoordinates
    content: MarkerContent
}

export interface MarkerPopupActions {
    onEdit: (marker: Marker) => void
    onDelete: (markerId: string) => void
    onAdd: (coordinates: MarkerCoordinates) => void
}

export interface DetailedPlaceInfo {
    placeReferences?: PlaceReferences
    name: string
    address: string
    placeId: string
    phone?: string
    website?: string
    rating?: number
    user_ratings_total?: number
    price_level?: number
    opening_hours?: any
    types?: string[]
}

export interface MapInteractionState {
    selectedMarkerId: string | null
    displayedMarkerId: string | null // 用于在边栏中显示内容的标记ID
    isPopupOpen: boolean
    isSidebarOpen: boolean
    popupCoordinates: MarkerCoordinates | null
    placeName: string | null // 地点名称
    highlightedDayId: string | null // 高亮显示连线的 day ID
}

export type MarkerAction =
    | { type: 'SELECT_MARKER'; markerId: string }
    | { type: 'DESELECT_MARKER' }
    | { type: 'OPEN_POPUP'; coordinates: MarkerCoordinates }
    | { type: 'CLOSE_POPUP' }
    | { type: 'OPEN_SIDEBAR' }
    | { type: 'CLOSE_SIDEBAR' }
    | { type: 'SET_PENDING_COORDINATES'; coordinates: MarkerCoordinates | null } 
