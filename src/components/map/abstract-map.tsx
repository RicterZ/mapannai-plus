'use client'

import { tripDestinations } from '@/lib/trips/destination'

import type { PlaceReferences } from '@/types/place-references'

import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'

import { SDKMapRenderer, MapRendererHandle, type MapAnchor } from './sdk-map-renderer'
import { ItineraryMapCards } from './itinerary-map-cards'
import { regionalRenderer, visibleMapCenter } from '@/lib/map/regional-renderer'
import { createBasemapStyle, toMapCoordinates, fromMapCoordinates } from '@/lib/map/basemap'
import { config } from '@/lib/config'
import { isInChina } from '@/lib/coord-transform'
import { installZoomThresholdBackdoor } from '@/lib/zoom-threshold'
import { SearchResultMarker, searchResultKey } from './search-result-marker'
import { searchService, searchDestinationPlaces, SearchResult } from '@/lib/api/search-service'
import { mergeSearchResults, type MapSearchResult } from '@/lib/map/search-results'
import { useMapStore } from '@/store/map-store'
import { MarkerCoordinates } from '@/types/marker'
import type { BasemapProviderType } from '@/types/map-provider'
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import { MapMarker } from './map-marker'
import { MapPopup } from './map-popup'
import { ConnectionLines } from './connection-lines'
import { AddMarkerModal } from '@/components/modal/add-marker-modal'
import { EditMarkerModal } from '@/components/modal/edit-marker-modal'
import { PlaceSearchPanel } from './place-search-panel'
import { LeftSidebar } from '@/components/sidebar/left-sidebar'
import { Sidebar } from '@/components/sidebar/sidebar'
import { ViewModeBanner } from '@/components/map/view-mode-banner'
import { cn } from '@/utils/cn'
import { upcomingTripFirstMarker } from '@/lib/map/startup-camera'
import { routeCamera } from '@/lib/map/route-presentation'
import { Modal } from '@/components/ui/modal'
import { AiPlanner } from '@/components/ai/ai-planner'
import { MarkerIconType } from '@/types/marker'
import Map, { Marker as MapboxMarker, MapRef, ViewState, MapProvider as ReactMapProvider } from 'react-map-gl/maplibre'

// Sidebar widths match the unobscured region used by the top capsule.
function mapWorkspaceViewport() {
    const state = useMapStore.getState()
    const desktop = window.innerWidth >= 1024
    const left = desktop && state.leftSidebar.isOpen ? document.querySelector('.left-sidebar')?.getBoundingClientRect().width ?? 400 : 0
    const right = desktop && state.interactionState.isSidebarOpen ? document.querySelector('.right-sidebar')?.getBoundingClientRect().width ?? 420 : 0
    return { width: Math.max(120, window.innerWidth - left - right), height: window.innerHeight, offset: [(left - right) / 2, 0] as [number, number] }
}

// 根据地图提供者导入相应的样式
import 'maplibre-gl/dist/maplibre-gl.css'

export const AbstractMap = ({ renderer, googleJsKey, amapJsKey, amapSecurityCode, routeProvider }: { renderer: BasemapProviderType; googleJsKey: string; amapJsKey: string; amapSecurityCode: string; routeProvider: string }) => {
    const searchPanelRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<any>(null)
    const suppressMapClickRef = useRef(false) // popup 内操作后短暂屏蔽地图点击
    const [error, setError] = useState<string | null>(null)
    const [mapInitialized, setMapInitialized] = useState(false)
    const [loadingRetryCount, setLoadingRetryCount] = useState(0)
    const [dataLoaded, setDataLoaded] = useState(false)
    const [pendingMarkerDelete, setPendingMarkerDelete] = useState<string | null>(null)
    const [deletingMarker, setDeletingMarker] = useState(false)

    // 存储地点名称，用于更新 popup title
    const draftPlaceReferences = useRef<PlaceReferences | undefined>(undefined)
    const placeLookupEpoch = useRef(0)
    const [currentPlaceName, setCurrentPlaceName] = useState<string | undefined>(undefined)
    
    // 存储地点地址，用于显示在 popup 中
    const [currentPlaceAddress, setCurrentPlaceAddress] = useState<string | undefined>(undefined)
    
    // 地点反查结果缓存
    const placeCacheRef = useRef<Record<string, { name: string; address?: string }>>({})
    
    // 从localStorage恢复上次的坐标，如果没有则使用默认坐标
    const getInitialViewState = (): ViewState => {
        if (typeof window === 'undefined') {
            return {
                longitude: config.app.defaultCenter.longitude,
                latitude: config.app.defaultCenter.latitude,
                zoom: config.app.defaultZoom,
                bearing: 0,
                pitch: 0,
                padding: {
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                },
            }
        }
        
        try {
            const savedViewState = localStorage.getItem('mapViewState')
            if (savedViewState) {
                const parsed = JSON.parse(savedViewState)
                return {
                    longitude: parsed.longitude || config.app.defaultCenter.longitude,
                    latitude: parsed.latitude || config.app.defaultCenter.latitude,
                    zoom: parsed.zoom || config.app.defaultZoom,
                    bearing: parsed.bearing || 0,
                    pitch: parsed.pitch || 0,
                    padding: {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                    },
                }
            }
        } catch (error) {
            // ignore parse errors
        }
        
        return {
            longitude: config.app.defaultCenter.longitude,
            latitude: config.app.defaultCenter.latitude,
            zoom: config.app.defaultZoom,
            bearing: 0,
            pitch: 0,
            padding: {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
            },
        }
    }

    const [viewState, setViewState] = useState<ViewState>(getInitialViewState())
    const [basemap, setBasemap] = useState(() => regionalRenderer(renderer, viewState))
    const isNative = basemap !== 'osm'
    const sdkRef = useRef<MapRendererHandle>(null)
    const projectItineraryPoint = useCallback((coordinates: MarkerCoordinates) => {
        if (isNative) return sdkRef.current?.project(coordinates)
        const point = toMapCoordinates(coordinates, basemap)
        const projected = mapRef.current?.project([point.longitude, point.latitude])
        return projected && { x: projected.x, y: projected.y }
    }, [isNative, basemap])
    const itineraryRoutePaths = useCallback(() => {
        if (isNative) return sdkRef.current?.routeScreenPaths() || []
        const state = useMapStore.getState()
        const byId = new globalThis.Map(state.markers.map(marker => [marker.id, marker]))
        return state.tripDays.filter(day => state.activeView.mode === 'day' ? day.id === state.activeView.dayId : day.tripId === state.activeView.tripId).flatMap(day => day.chains.map(chain => chain.flatMap(id => {
            const marker = byId.get(id)
            const point = marker && projectItineraryPoint(marker.coordinates)
            return point ? [point] : []
        })))
    }, [isNative, projectItineraryPoint])
    const maplibreModule = useRef<typeof import('maplibre-gl') | null>(null)
    useEffect(() => { if (!isNative) import('maplibre-gl').then(module => { maplibreModule.current = module }) }, [isNative])
    const createItineraryAnchor = useCallback((coordinates: MarkerCoordinates): MapAnchor | undefined => {
        if (isNative) return sdkRef.current?.createAnchor(coordinates)
        const map = mapRef.current?.getMap(), module = maplibreModule.current
        if (!map || !module) return
        const node = document.createElement('div')
        node.style.cssText = 'width:0;height:0;overflow:visible;z-index:3'
        const point = toMapCoordinates(coordinates, basemap)
        const marker = new module.Marker({ element: node, anchor: 'top-left' }).setLngLat([point.longitude, point.latitude]).addTo(map)
        return { node, dispose: () => { marker.remove(); node.remove() } }
    }, [isNative, basemap])
    const subscribeItineraryCamera = useCallback((update: () => void, moving: () => void) => {
        if (isNative) return sdkRef.current?.subscribeCamera(update, moving) || (() => {})
        const map = mapRef.current?.getMap()
        map?.on('moveend', update)
        map?.on('movestart', moving)
        return () => { map?.off('moveend', update); map?.off('movestart', moving) }
    }, [isNative, basemap])

    const flyMap = useCallback((options: { center: [number, number]; zoom?: number; duration?: number; offset?: [number, number] }) => {
        if (isNative) sdkRef.current?.flyTo(options)
        else mapRef.current?.flyTo(options)
    }, [isNative])
    const toDisplay = useCallback((c: { longitude: number; latitude: number }) => toMapCoordinates(c, basemap), [basemap])
    const fromDisplay = useCallback((c: { longitude: number; latitude: number }) => fromMapCoordinates(c, basemap), [basemap])
    const mapStyle = useMemo(() => createBasemapStyle(typeof window !== 'undefined' ? window.location.origin : ''), [basemap])
    const [addMarkerEnabled, setAddMarkerEnabled] = useState(() => {
        if (typeof window === 'undefined') return true
        const saved = localStorage.getItem('addMarkerEnabled')
        return saved === null ? false : saved === 'true'
    })

    const toggleAddMarker = () => {
        const next = !addMarkerEnabled
        localStorage.setItem('addMarkerEnabled', String(next))
        if (next) useMapStore.getState().closeSidebar()
        setAddMarkerEnabled(next)
    }
    useEffect(() => {
        useMapStore.getState().setEditMode(addMarkerEnabled)
        if (!addMarkerEnabled) setPendingMarkerDelete(null)
    }, [addMarkerEnabled])

    // 通用的位置保存函数
    const saveViewState = useCallback((viewState: { longitude: number; latitude: number; zoom: number; bearing?: number; pitch?: number }) => {
        try {
            localStorage.setItem('mapViewState', JSON.stringify({
                longitude: viewState.longitude,
                latitude: viewState.latitude,
                zoom: viewState.zoom,
                bearing: viewState.bearing || 0,
                pitch: viewState.pitch || 0,
            }))
        } catch (error) {
            // ignore save errors
        }
    }, [])
    const handleSdkMove = useCallback((next: { longitude: number; latitude: number; zoom: number }) => {
        setViewState(previous => ({ ...previous, ...next }))
        saveViewState(next)
        const center = visibleMapCenter(next, basemap, mapWorkspaceViewport().offset)
        const target = regionalRenderer(renderer, center)
        if (target !== basemap) {
            setMapInitialized(false)
            setError(null)
            setBasemap(target)
        }
    }, [renderer, basemap, saveViewState])


    // 右下角搜索栏状态
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchTarget, setSearchTarget] = useState<{ tripId: string; dayId: string | null } | null>(null)
    const [addingSearchKey, setAddingSearchKey] = useState<string | null>(null)
    const [fabQuery, setFabQuery] = useState('')
    const [providerResults, setProviderResults] = useState<SearchResult[]>([])
    const [providerQuery, setProviderQuery] = useState('')
    const [selectedSearchKey, setSelectedSearchKey] = useState<string | null>(null)
    const selectedSearchRef = useRef<string | null>(null)
    const [fabQueryError, setFabQueryError] = useState('')
    const [isSearching, setIsSearching] = useState(false)

    const {
        markers,
        trips,
        tripDays,
        tripsLoaded,
        interactionState,
        addMarkerModal,
        editMarkerModal,
        leftSidebar,
        isLoading,
        error: storeError,
        openPopup,
        closePopup,
        selectMarker,
        openAddMarkerModal,
        closeAddMarkerModal,
        openEditMarkerModal,
        closeEditMarkerModal,
        toggleLeftSidebar,
        createMarkerFromModal,
        updateMarkerFromModal,
        loadMarkersFromDataset,
        clearError,
        openSidebar,
        closeSidebar,
        activeView,
        addMarkerToDay,
    } = useMapStore()

    const { isPopupOpen, popupCoordinates, selectedMarkerId, isSidebarOpen } = interactionState

    // Compute visibleMarkers based on activeView
    // Day/Trip 模式仍显示所有标记，让用户可以点击「加入今天」
    // 视觉区分（高亮/置灰）由 MapMarker 组件负责
    const visibleMarkers = markers
    const fabResults = useMemo(() => mergeSearchResults(fabQuery, markers, providerQuery === fabQuery.trim() ? providerResults : []), [fabQuery, markers, providerQuery, providerResults])
    const searchOverlayResults = useMemo(() => fabResults.filter(result => !result.markerId), [fabResults])

    const handleCloseSidebar = useCallback(() => closeSidebar(), [closeSidebar])

    // 地图初始化成功后设置状态
    const handleMapLoad = useCallback(() => {
        setMapInitialized(true)
        setError(null)
    }, [])

    // 监听跳转到中心的事件
    useEffect(() => {
        const handleJumpToCenter = (event: CustomEvent) => {
            const { coordinates, zoom } = event.detail
            if (mapRef.current || sdkRef.current) {
                flyMap({ center: [coordinates.longitude, coordinates.latitude], zoom, duration: 2000 })
            }
        }

        window.addEventListener('jumpToCenter', handleJumpToCenter as EventListener)
        return () => {
            window.removeEventListener('jumpToCenter', handleJumpToCenter as EventListener)
        }
    }, [flyMap])

    // Keep camera navigation responsive, including long-distance jumps.
    const flyDuration = useCallback((to: { longitude: number; latitude: number }): number => {
        const R = 6371 // 地球半径 km
        const lat1 = viewState.latitude * Math.PI / 180
        const lat2 = to.latitude * Math.PI / 180
        const dLat = (to.latitude - viewState.latitude) * Math.PI / 180
        const dLon = (to.longitude - viewState.longitude) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
        const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        const t = Math.min(1, Math.max(0, (km - 10) / (200 - 10)))
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.round(600 + t * 400)
    }, [viewState.latitude, viewState.longitude])

    // 地图flyTo功能
    const handleFlyTo = useCallback((coordinates: { longitude: number; latitude: number }, zoom?: number) => {
        if (mapRef.current || sdkRef.current) {
            flyMap({ center: [coordinates.longitude, coordinates.latitude], offset: mapWorkspaceViewport().offset, zoom, duration: flyDuration(coordinates) })
        }
    }, [flyDuration, flyMap])
    const handleFitMarkers = useCallback((ids: string[]) => {
        const state = useMapStore.getState()
        const viewport = mapWorkspaceViewport()
        const camera = routeCamera(state.markers.filter(marker => ids.includes(marker.id)), viewport.width, viewport.height, isNative ? 256 : 512)
        if (!camera) return
        state.closePopup()
        if (window.innerWidth < 1024) state.closeLeftSidebar()
        flyMap({ center: [camera.longitude, camera.latitude], zoom: Math.max(2, camera.zoom - 0.5), duration: flyDuration(camera), offset: viewport.offset })
    }, [flyMap, flyDuration, isNative])

    const handleAiMarkersCreated = useCallback((ids: string[], panel: DOMRect | null) => {
        const state = useMapStore.getState()
        const places = state.markers.filter(marker => ids.includes(marker.id))
        if (!places.length || (!mapRef.current && !sdkRef.current)) return
        const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight
        // Fit the unobscured rectangle, including the existing left sidebar.
        const mobilePanel = panel && panel.width >= viewportWidth - 1
        if (mobilePanel) state.closeLeftSidebar()
        const left = state.leftSidebar.isOpen && viewportWidth >= 1024 ? 400 : 0
        const right = panel && !mobilePanel ? panel.left : viewportWidth
        const bottom = mobilePanel ? panel.top : viewportHeight
        const camera = routeCamera(places, Math.max(120, right - left), Math.max(160, bottom), isNative ? 256 : 512)
        if (!camera) return
        state.closePopup()
        flyMap({ center: [camera.longitude, camera.latitude], zoom: places.length === 1 ? 15 : camera.zoom,
            duration: flyDuration(camera), offset: [(left + right - viewportWidth) / 2, (bottom - viewportHeight) / 2] })
    }, [flyMap, flyDuration, isNative])

    const startupCameraApplied = useRef(false)
    useEffect(() => {
        if (startupCameraApplied.current || !mapInitialized || !dataLoaded || !tripsLoaded) return
        startupCameraApplied.current = true
        const state = useMapStore.getState()
        // Opening always starts in overview, even if the URL retains yesterday's selection.
        state.setActiveView('overview', null, null)
        state.selectMarker(null)
        state.closePopup()
        state.closeSidebar()
        const marker = upcomingTripFirstMarker(trips, tripDays, markers)
        if (marker) flyMap({ center: [marker.coordinates.longitude, marker.coordinates.latitude], zoom: config.app.defaultZoom, duration: 1000 })
    }, [mapInitialized, dataLoaded, tripsLoaded, trips, tripDays, markers, flyMap])

    const activeDestinations = activeView.mode !== 'overview'
        ? tripDestinations(trips.find(trip => trip.id === activeView.tripId)) : []
    const activeDestination = activeDestinations[0]
    const destinationKey = activeDestinations.length ? `${activeView.tripId}:${activeDestinations.map(item => `${item.longitude}:${item.latitude}`).join('|')}` : null
    const lastFocusedTripRef = useRef<string | null>(null)
    useEffect(() => {
        if (activeView.mode !== 'trip') { lastFocusedTripRef.current = null; return }
        if (!mapInitialized || activeView.focusFirstMarker === false || lastFocusedTripRef.current === activeView.tripId) return
        const trip = trips.find(item => item.id === activeView.tripId)
        if (!trip) return
        const days = tripDays.filter(day => day.tripId === trip.id)
        const ids = Array.from(new Set([...(trip.markerIds || []), ...days.flatMap(day => [...day.markerIds, ...day.chains.flat()])]))
        const validIds = markers.filter(marker => ids.includes(marker.id) && Number.isFinite(marker.coordinates.longitude) && Number.isFinite(marker.coordinates.latitude) && Math.abs(marker.coordinates.longitude) <= 180 && Math.abs(marker.coordinates.latitude) <= 90).map(marker => marker.id)
        if (!validIds.length) return
        lastFocusedTripRef.current = trip.id
        handleFitMarkers(validIds)
    }, [activeView.mode, activeView.tripId, activeView.focusFirstMarker, mapInitialized, trips, tripDays, markers, handleFitMarkers])

    const lastDestinationRef = useRef<string | null>(null)
    useEffect(() => {
        if (!destinationKey || !activeDestination) { lastDestinationRef.current = null; return }
        if (!mapInitialized || lastDestinationRef.current === destinationKey || activeView.focusFirstMarker === false) return
        lastDestinationRef.current = destinationKey
        if (activeView.mode === 'trip') {
            const trip = trips.find(item => item.id === activeView.tripId)
            const ids = new Set([...(trip?.markerIds || []), ...tripDays.filter(day => day.tripId === activeView.tripId).flatMap(day => [...day.markerIds, ...day.chains.flat()])])
            if (markers.some(marker => ids.has(marker.id))) return
        }
        if (activeView.mode === 'day') {
            const day = tripDays.find(day => day.id === activeView.dayId)
            if (day && markers.some(marker => day.markerIds.includes(marker.id) || day.chains.some(chain => chain.includes(marker.id)))) return
        }
        flyMap({ center: [activeDestination.longitude, activeDestination.latitude], zoom: 11, duration: 1000, offset: mapWorkspaceViewport().offset })
    }, [destinationKey, activeDestination, mapInitialized, activeView.mode, activeView.dayId, activeView.focusFirstMarker, tripDays, trips, markers, flyMap])

    const lastFocusedDayRef = useRef<string | null>(null)
    useEffect(() => {
        if (activeView.mode !== 'day' || !activeView.dayId) {
            lastFocusedDayRef.current = null
            return
        }
        if (activeView.focusFirstMarker === false) {
            lastFocusedDayRef.current = null
            return
        }
        if (!mapInitialized || lastFocusedDayRef.current === activeView.dayId || (!mapRef.current && !sdkRef.current)) return
        const day = tripDays.find(item => item.id === activeView.dayId)
        if (!day) return
        const ids = [...day.markerIds, ...day.chains.flat()]
        if (!markers.some(marker => ids.includes(marker.id))) return
        lastFocusedDayRef.current = activeView.dayId
        handleFitMarkers(ids)
    }, [activeView.mode, activeView.dayId, activeView.focusFirstMarker, tripDays, markers, handleFitMarkers, mapInitialized])

    const searchTrip = trips.find(trip => trip.id === (searchOpen ? searchTarget?.tripId : activeView.tripId))
    const searchDestinations = searchOpen ? tripDestinations(searchTrip) : activeDestinations
    const searchScopeKey = `${searchTarget?.tripId ?? destinationKey}:${searchDestinations.map(item => `${item.longitude}:${item.latitude}`).join('|')}`
    const searchTargetDay = tripDays.find(day => day.id === searchTarget?.dayId)
    const searchDayNumber = tripDays.filter(day => day.tripId === searchTarget?.tripId).sort((a, b) => a.date.localeCompare(b.date)).findIndex(day => day.id === searchTarget?.dayId) + 1
    const searchLocationLabel = searchTarget?.dayId
        ? searchTargetDay ? searchTargetDay.title || `第${searchDayNumber}天` : '日期已删除'
        : '未分配日期'
    const searchTargetLabel = searchTarget ? `${searchTrip?.name || '旅行'} · ${searchLocationLabel}` : null
    const openPlaceSearch = () => {
        const state = useMapStore.getState()
        setSearchTarget(state.activeView.tripId ? { tripId: state.activeView.tripId, dayId: state.activeView.mode === 'day' ? state.activeView.dayId : null } : null)
        setSearchOpen(true)
        state.openLeftSidebar()
        state.closeSidebar()
        state.closePopup()
    }
    const closePlaceSearch = () => {
        setSearchOpen(false)
        setFabQuery('')
        setProviderResults([])
        setSearchTarget(null)
        closePopup()
        useMapStore.getState().openLeftSidebar()
    }
    useEffect(() => {
        if (!searchOpen || addMarkerModal.isOpen || editMarkerModal.isOpen) return
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented) closePlaceSearch()
        }
        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [searchOpen, addMarkerModal.isOpen, editMarkerModal.isOpen])
    const isSearchResultAdded = (result: MapSearchResult) => {
        if (!result.markerId) return false
        if (!searchTarget) return true
        if (searchTarget.dayId) return !!searchTargetDay?.markerIds.includes(result.markerId)
        return !!searchTrip?.markerIds?.includes(result.markerId) || tripDays.some(day => day.tripId === searchTarget.tripId && day.markerIds.includes(result.markerId!))
    }
    const addSearchResult = async (result: MapSearchResult) => {
        if (addingSearchKey || isSearchResultAdded(result)) return
        if (!result.markerId) {
            placeLookupEpoch.current++
            setCurrentPlaceAddress(result.address)
            setCurrentPlaceName(result.name)
            openAddMarkerModal(result.coordinates, result.name, result.placeReferences)
            return
        }
        setAddingSearchKey(searchResultKey(result))
        try {
            if (searchTarget?.dayId) await addMarkerToDay(searchTarget.tripId, searchTarget.dayId, result.markerId)
            else if (searchTarget) await useMapStore.getState().setTripMarker(searchTarget.tripId, result.markerId, true)
        } catch (error) { toast.error(error instanceof Error ? error.message : '添加失败，请重试') }
        finally { setAddingSearchKey(null) }
    }

    // 右下角搜索：防抖自动搜索（输入≥2字）
    useEffect(() => {
        const trimmedQuery = fabQuery.trim()
        if (selectedSearchRef.current) closePopup()
        selectedSearchRef.current = null
        setProviderResults([])
        setProviderQuery(trimmedQuery)
        setSelectedSearchKey(null)
        
        // 如果查询为空，清除结果
        if (!trimmedQuery) {
            setProviderResults([])
            setFabQueryError('')
            setIsSearching(false)
            return
        }
        
        // 少于2个字符只匹配本地地点，不请求平台
        if (trimmedQuery.length < 2) {
            setProviderResults([])
            setFabQueryError('')
            setIsSearching(false)
            return
        }
        
        // 防抖：延迟500ms后执行搜索
        const controller = new AbortController()
        const searchTimeout = setTimeout(async () => {
            try {
                setIsSearching(true)
                setFabQueryError('')
                const map = mapRef.current?.getMap()
                const bounds = isNative ? sdkRef.current?.getSearchBounds() : (() => {
                    const b = map?.getBounds()
                    return b ? { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } : undefined
                })()
                // Extend each side by 20% so nearby places remain discoverable.
                const searchBounds = bounds && bounds.west < bounds.east ? {
                    west: Math.max(-180, bounds.west - (bounds.east - bounds.west) * 0.2),
                    east: Math.min(180, bounds.east + (bounds.east - bounds.west) * 0.2),
                    south: Math.max(-90, bounds.south - (bounds.north - bounds.south) * 0.2),
                    north: Math.min(90, bounds.north + (bounds.north - bounds.south) * 0.2),
                } : undefined
                const results = searchDestinations.length
                    ? await searchDestinationPlaces(trimmedQuery, searchDestinations, controller.signal)
                    : await searchService.searchPlaces(trimmedQuery, 20, 'zh-CN', 'CN', { bounds: searchBounds, signal: controller.signal })
                if (controller.signal.aborted) return
                setProviderResults(results)
            } catch (e) {
                if (controller.signal.aborted) return
                setFabQueryError(e instanceof Error ? e.message : '搜索失败，请稍后再试')
                setProviderResults([])
            } finally {
                if (!controller.signal.aborted) setIsSearching(false)
            }
        }, 500)
        
        // 清理定时器
        return () => {
            clearTimeout(searchTimeout)
            controller.abort()
        }
    }, [searchScopeKey, fabQuery, isNative, closePopup])

    const handleFabResultClick = useCallback((result: MapSearchResult) => {
        selectedSearchRef.current = searchResultKey(result)
        setSelectedSearchKey(selectedSearchRef.current)
        placeLookupEpoch.current++ // Cancel nearby detail results from an older manual click.
        draftPlaceReferences.current = result.markerId ? undefined : result.placeReferences
        setCurrentPlaceName(result.name)
        setCurrentPlaceAddress(result.address)
        selectMarker(result.markerId ?? null)
        openPopup(result.coordinates)
        if (result.markerId) {
            const { tripDays, setHighlightedDay, activeView } = useMapStore.getState()
            if (activeView.mode !== 'day') setHighlightedDay(tripDays.find(day => day.markerIds.includes(result.markerId!))?.id ?? null)
        }
        const desktop = window.innerWidth >= 1024
        const sidebarWidth = desktop ? document.querySelector('.left-sidebar')?.getBoundingClientRect().width ?? 400 : 0
        if (!desktop) useMapStore.getState().closeLeftSidebar()
        flyMap({ center: [result.coordinates.longitude, result.coordinates.latitude], zoom: 16,
            offset: [sidebarWidth / 2, -60], duration: flyDuration(result.coordinates) })
    }, [openPopup, selectMarker, flyMap, flyDuration])

    // 静默重试加载数据
    const silentRetryLoad = useCallback(async () => {
        if (loadingRetryCount >= 3 || dataLoaded) return // 如果已加载成功，不再重试

        try {
            await loadMarkersFromDataset()
            setLoadingRetryCount(0) // 成功后重置计数
            setDataLoaded(true) // 标记数据已加载
        } catch (error) {
            setLoadingRetryCount(prev => prev + 1)

            // 延迟重试
            setTimeout(() => {
                if (loadingRetryCount < 2) {
                    silentRetryLoad()
                }
            }, 2000 * (loadingRetryCount + 1)) // 2s, 4s, 6s 延迟
        }
    }, [loadMarkersFromDataset, loadingRetryCount, dataLoaded])

    // 安装 F12 Console backdoor，允许动态调整 zoomThreshold
    useEffect(() => {
        installZoomThresholdBackdoor()
    }, [])

    // 页面加载时从 Dataset 加载标记（静默失败，防止重复加载）
    useEffect(() => {
        if (dataLoaded) return // 如果已经加载过，不再重复加载

        const loadData = async () => {
            try {
                await loadMarkersFromDataset()
                setDataLoaded(true)
            } catch (error) {
                // 不设置错误状态，让地图正常显示
                silentRetryLoad()
            }
        }

        loadData()
    }, [loadMarkersFromDataset, silentRetryLoad, dataLoaded])

    // 定时轮询已禁用（会在编辑器打开时覆盖正在编辑的内容，且单用户场景收益低）
    // TODO: 改为 MCP 写操作后推送增量事件，替代全量轮询

    // 监听严重错误（只有地图本身无法加载才显示错误页面）
    useEffect(() => {
        if (storeError) {
            // 如果地图已经初始化，只显示通知而不阻塞整个界面
            if (mapInitialized) {
                console.error('存储错误（地图已加载）:', storeError)
                // 3秒后自动清除错误
                const timer = setTimeout(() => {
                    clearError()
                }, 3000)
                return () => clearTimeout(timer)
            }
        }
    }, [storeError, clearError, mapInitialized])

    // 地图错误处理
    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            console.error('Map error:', event.error)
        }

        window.addEventListener('error', handleError)
        return () => window.removeEventListener('error', handleError)
    }, [])

    // 生成缓存键的函数
    const generateCacheKey = useCallback((coordinates: { latitude: number; longitude: number }, zoom: number) => {
        // 根据缩放级别确定精度 - 扩大缓存范围
        // zoom 1-4: 0.2度精度 (约22km)
        // zoom 5-8: 0.02度精度 (约2.2km)  
        // zoom 9-12: 0.002度精度 (约220m)
        // zoom 13-16: 0.0002度精度 (约22m)
        // zoom 17+: 0.0001度精度 (约11m)
        let precision = 0.2
        if (zoom >= 5) precision = 0.02
        if (zoom >= 9) precision = 0.002
        if (zoom >= 13) precision = 0.0002
        if (zoom >= 17) precision = 0.0001
        
        const lat = Math.round(coordinates.latitude / precision) * precision
        const lng = Math.round(coordinates.longitude / precision) * precision
        const zoomLevel = Math.floor(zoom / 3) * 3 // 将缩放级别分组，每3级一组，进一步扩大范围
        
        return `${lat.toFixed(4)},${lng.toFixed(4)},${zoomLevel}`
    }, [])

    // 通过后端API获取地点信息
    const getPlaceIdAsync = useCallback(async (coordinates: { latitude: number; longitude: number }) => {
        const epoch = ++placeLookupEpoch.current
        try {
            const response = await fetchWithAuth('/api/places', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    latitude: coordinates.latitude,
                    longitude: coordinates.longitude,
                    isChina: isInChina(coordinates.longitude, coordinates.latitude),
                })
            })
            
            if (!response.ok) {
                throw new Error(`获取地点信息失败: ${response.status}`)
            }
            
            const result = await response.json()
            
            if (epoch === placeLookupEpoch.current && result.success && result.data) {
                const placeInfo = result.data
                setCurrentPlaceName(placeInfo.name)
                setCurrentPlaceAddress(placeInfo.address)
            }
        } catch (error) {
            console.error('获取地点信息时出错:', error)
        }
    }, [setCurrentPlaceName, setCurrentPlaceAddress])

    const handleMapClick = useCallback(async (event: any, placeInfo?: { name: string; address: string; placeId: string }, clickPosition?: { x: number; y: number }, isMarkerClick?: boolean) => {
        if (suppressMapClickRef.current) return
        // Route touches belong to the route, even outside its visible stroke.
        const map = mapRef.current?.getMap()
        if (event.point && map?.getLayer('connection-lines-hit-area') && map.queryRenderedFeatures(event.point, { layers: ['connection-lines-hit-area'] }).length) return
        // 直接从store获取最新状态，避免闭包中的旧状态
        const currentState = useMapStore.getState()
        const currentSidebarOpen = currentState.interactionState.isSidebarOpen
        const currentSelectedMarkerId = currentState.interactionState.selectedMarkerId

        try {
            // Prevent map click when clicking on markers
            if (event.originalEvent?.target &&
                (event.originalEvent.target as HTMLElement).closest('.map-marker, .map-search-marker')) {
                return
            }

            // Prevent map click when clicking on popup
            if (event.originalEvent?.target &&
                (event.originalEvent.target as HTMLElement).closest('.map-popup')) {
                return
            }

            // Prevent map click when clicking on right sidebar
            if (event.originalEvent?.target &&
                (event.originalEvent.target as HTMLElement).closest('.right-sidebar')) {
                return
            }

            // Mapbox 事件对象格式
            let coordinates: MarkerCoordinates
            if (event.lngLat && event.lngLat.lat !== undefined && event.lngLat.lng !== undefined) {
                coordinates = event.canonical ? { latitude: event.lngLat.lat, longitude: event.lngLat.lng } : fromDisplay({
                    latitude: event.lngLat.lat,
                    longitude: event.lngLat.lng,
                })
            } else {
                return
            }

            // If popup is open, close it + 清除标记触发的连线高亮
            if (isPopupOpen) {
                closePopup()
                selectMarker(null)
                useMapStore.getState().setHighlightedDay(null)
                // 仅在开关开启时才在新位置重新打开 popup
                if (addMarkerEnabled) {
                    draftPlaceReferences.current = undefined
                    setCurrentPlaceName(undefined)
                    setCurrentPlaceAddress(undefined)
                    openPopup(coordinates)
                    getPlaceIdAsync(coordinates)
                }
                return
            }

            // If sidebar is open, first click closes sidebar
            if (isSidebarOpen) {
                handleCloseSidebar()
                return
            }

            // 开关关闭时，空白处 click 清除线触发的持久高亮
            if (!addMarkerEnabled) {
                useMapStore.getState().setHighlightedDay(null)
                return
            }

            // 无 popup、无 sidebar：在点击位置打开新标记 popup
            selectMarker(null)
            draftPlaceReferences.current = undefined
            setCurrentPlaceName(undefined)
            setCurrentPlaceAddress(undefined)
            openPopup(coordinates)
            getPlaceIdAsync(coordinates)
        } catch (err) {
            console.error('Map click error:', err)
            // 不设置严重错误，只是控制台输出
        }
    }, [isPopupOpen, isSidebarOpen, openPopup, closePopup, closeSidebar, selectMarker, selectedMarkerId, addMarkerEnabled, fromDisplay, getPlaceIdAsync])

    const handleMarkerClick = useCallback((markerId: string) => {
        placeLookupEpoch.current++
        draftPlaceReferences.current = undefined
        selectedSearchRef.current = null
        setSelectedSearchKey(null)
        try {
            const marker = markers.find(m => m.id === markerId)
            if (!marker) return

            selectMarker(markerId)
            openPopup(marker.coordinates)
            const { tripDays, setHighlightedDay, activeView } = useMapStore.getState()
            if (activeView.mode !== 'day') {
                const day = tripDays.find(d => d.markerIds.includes(markerId))
                setHighlightedDay(day?.id ?? null)
            }
        } catch (err) {
            console.error('Marker click error:', err)
        }
    }, [markers, selectMarker, openSidebar, closePopup, openPopup])

    const handleAddMarker = useCallback((placeName?: string) => {
        try {
            if (!popupCoordinates) return

            // 关闭popup
            closePopup()
            
            // 打开新增弹窗而不是直接添加marker，传递地点名称
            placeLookupEpoch.current++
            openAddMarkerModal(popupCoordinates, placeName, draftPlaceReferences.current)
        } catch (err) {
            console.error('Add marker error:', err)
        }
    }, [popupCoordinates, openAddMarkerModal, closePopup])

    const handleViewMarker = useCallback((markerId: string) => {
        try {
            selectMarker(markerId)
            closePopup()
            openSidebar()
            const state = useMapStore.getState()
            const marker = state.markers.find(item => item.id === markerId)
            if (marker && window.innerWidth >= 1024) {
                flyMap({ center: [marker.coordinates.longitude, marker.coordinates.latitude], offset: [(state.leftSidebar.isOpen ? 400 : 0) / 2 - 210, -40], duration: 500 })
            }
        } catch (err) {
            console.error('View marker error:', err)
        }
    }, [selectMarker, openSidebar, closePopup, flyMap])

    const handleDeleteMarker = useCallback((markerId: string) => {
        if (useMapStore.getState().editMode.isEnabled) setPendingMarkerDelete(markerId)
    }, [closePopup])

    const createdPlaceRef = useRef<string | null>(null)
    useEffect(() => { if (!addMarkerModal.isOpen) createdPlaceRef.current = null }, [addMarkerModal.isOpen])
    const handleSaveNewMarker = useCallback(async (data: {
        coordinates: MarkerCoordinates
        name: string
        iconType: MarkerIconType
        address?: string
        placeReferences?: PlaceReferences
        headerImage?: string
        markdownContent: string
    }) => {
        const { activeView: view } = useMapStore.getState()
        const tripId = searchOpen ? searchTarget?.tripId : view.tripId
        const dayId = searchOpen ? searchTarget?.dayId : view.dayId
        const markerId = createdPlaceRef.current ?? await createMarkerFromModal(data)
        if (createdPlaceRef.current) {
            await updateMarkerFromModal({ markerId, title: data.name, iconType: data.iconType,
                headerImage: data.headerImage, markdownContent: data.markdownContent })
        }
        createdPlaceRef.current = markerId
        try {
            if (tripId && dayId) await addMarkerToDay(tripId, dayId, markerId)
            else if (tripId) await useMapStore.getState().setTripMarker(tripId, markerId, true)
        } catch {
            throw new Error('地点已保存，加入行程失败。再次保存可重试加入。')
        }
        closePopup()
    }, [createMarkerFromModal, updateMarkerFromModal, addMarkerToDay, searchOpen, searchTarget, closePopup])

    const handleUpdateMarker = useCallback(async (data: {
        markerId: string
        title?: string
        headerImage?: string
        markdownContent: string
        iconType?: MarkerIconType
    }) => {
        await updateMarkerFromModal(data)
    }, [updateMarkerFromModal])

    const handleRetry = useCallback(() => {
        setError(null)
        setLoadingRetryCount(0)
        setDataLoaded(false) // 重置数据加载状态
        // 重新尝试加载数据
        loadMarkersFromDataset().then(() => {
            setDataLoaded(true)
        }).catch(error => {
            console.error('重试加载失败:', error)
            setError('加载失败，请检查网络连接')
        })
    }, [loadMarkersFromDataset])

    // 只有地图本身加载失败才显示错误页面
    if (error && !mapInitialized) {
        return (
            <div className="w-full h-screen flex items-center justify-center bg-red-50">
                <div className="text-center p-8 bg-white rounded-lg shadow-lg max-w-md">
                    <div className="text-red-500 text-6xl mb-4">⚠️</div>
                    <h2 className="text-xl font-semibold text-red-800 mb-2">地图加载错误</h2>
                    <p className="text-red-600 mb-4">{error}</p>
                    <div className="space-y-2">
                        <button
                            onClick={handleRetry}
                            className="block w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                        >
                            重试
                        </button>
                        <p className="text-xs text-gray-500">
                            如果问题持续，请检查地图配置是否有效
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="fixed inset-0 map-container">
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="absolute bottom-8 right-1 z-10 bg-white/90 px-1 text-[10px] text-gray-600">铁路数据 © OpenStreetMap contributors · ODbL</a>
            {/* 数据加载指示器（非阻塞） */}
            {isLoading && (
                <div className="absolute top-4 right-4 z-50 bg-accent-600 text-white px-3 py-2 rounded-md shadow-lg">
                    <div className="flex items-center space-x-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        <span className="text-sm">同步中...</span>
                    </div>
                </div>
            )}

            {/* 数据加载错误通知（非阻塞） */}
            {storeError && mapInitialized && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-amber-500 text-white px-4 py-2 rounded-md shadow-lg flex items-center space-x-2">
                    <span className="text-sm">⚠️ {storeError}</span>
                    <button
                        onClick={() => clearError()}
                        className="text-white hover:text-amber-200"
                    >
                        ×
                    </button>
                </div>
            )}

            {/* 重试提示（数据加载失败时） */}
            {loadingRetryCount > 0 && loadingRetryCount < 3 && (
                <div className="absolute top-16 right-4 z-50 bg-gray-600 text-white px-3 py-2 rounded-md shadow-lg text-sm">
                    数据加载重试中... ({loadingRetryCount}/3)
                </div>
            )}

            {/* 左上角：标记列表按钮 */}
            <div className={cn('absolute left-4 z-50', leftSidebar.isOpen && 'hidden')} style={{ top: 'calc(env(safe-area-inset-top) + env(safe-area-inset-top) + 12px)' }}>
                <button
                    onClick={toggleLeftSidebar}
                    className={cn(
                        'w-12 h-12 rounded-full shadow-lg border border-gray-200 bg-white',
                        'flex items-center justify-center',
                        'hover:bg-gray-50 transition-colors duration-150',
                        'focus:outline-none touch-manipulation'
                    )}
                    aria-label="展开 MapAnNai 侧栏"
                    title="展开 MapAnNai 侧栏"
                >
                    <svg className="w-[18px] h-[18px] text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2,7 L8,8.5 L8,19.5 L2,18 Z" />
                        <path d="M8,8.5 L16,6 L16,17 L8,19.5 Z" />
                        <path d="M16,6 L22,8 L22,19 L16,17 Z" />
                    </svg>
                </button>
            </div>

            <AiPlanner onMarkersCreated={handleAiMarkersCreated} />

            {/* 视图模式面包屑 Banner */}
            <ViewModeBanner />

            {/* 左侧边栏 */}
            <LeftSidebar onFlyTo={handleFlyTo} onFitMarkers={handleFitMarkers} routeProvider={routeProvider} addMarkerEnabled={addMarkerEnabled} onToggleAddMarker={toggleAddMarker} onSearchPlaces={openPlaceSearch} searchPanel={searchOpen ? <PlaceSearchPanel ref={searchPanelRef} open={searchOpen} query={fabQuery} results={fabResults} selectedKey={selectedSearchKey} busy={isSearching} addingKey={addingSearchKey} error={fabQueryError} targetLabel={searchTargetLabel} isAdded={isSearchResultAdded}
                onClose={closePlaceSearch} onQuery={query => { setFabQuery(query); setFabQueryError('') }} onSelect={handleFabResultClick} onAdd={result => { void addSearchResult(result) }} /> : undefined} />

            {pendingMarkerDelete && <Modal title="删除这个地点？" onClose={() => setPendingMarkerDelete(null)} busy={deletingMarker}>
                <p className="text-sm text-gray-600">「{markers.find(marker => marker.id === pendingMarkerDelete)?.content.title || '未命名地点'}」将从地图及所有行程中删除。</p>
                <div className="mt-5 flex justify-end gap-2">
                    <button disabled={deletingMarker} onClick={() => setPendingMarkerDelete(null)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">取消</button>
                    <button disabled={deletingMarker} onClick={async () => {
                        setDeletingMarker(true)
                        try { await useMapStore.getState().deleteMarker(pendingMarkerDelete); setPendingMarkerDelete(null); closePopup(); toast.success('地点已删除') }
                        catch { toast.error('删除失败，请重试') }
                        finally { setDeletingMarker(false) }
                    }} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">{deletingMarker ? '删除中…' : '删除地点'}</button>
                </div>
            </Modal>}

            {/* 右侧详情栏 */}
            <Sidebar />

            {/* 地图组件 */}
                {isNative ? <SDKMapRenderer
                    key={basemap}
                    renderer={basemap as 'amap' | 'google'}
                    ref={sdkRef}
                    apiKey={basemap === 'google' ? googleJsKey : amapJsKey}
                    securityCode={amapSecurityCode}
                    routeProvider={routeProvider}
                    viewState={viewState}
                    markers={visibleMarkers}
                    searchResults={searchOverlayResults}
                    selectedSearchKey={selectedSearchKey}
                    onSearchResultClick={handleFabResultClick}
                    selectedMarkerId={selectedMarkerId}
                    popupCoordinates={isPopupOpen ? popupCoordinates : null}
                    userLocation={null}
                    onMove={handleSdkMove}
                    onLoad={handleMapLoad}
                    onClick={(coordinates, originalEvent) => handleMapClick({ lngLat: { lng: coordinates.longitude, lat: coordinates.latitude }, originalEvent, canonical: true })}
                    onMarkerClick={handleMarkerClick}
                    onError={error => { setMapInitialized(false); setError(error.message) }}
                    popup={isPopupOpen && popupCoordinates ? <MapPopup
                        coordinates={popupCoordinates}
                        basemap={basemap}
                        embedded
                        selectedMarkerId={selectedMarkerId}
                        hideAssignment={searchOpen}
                        onAddMarker={handleAddMarker}
                        onViewMarker={handleViewMarker}
                        onDeleteMarker={handleDeleteMarker}
                        onClose={closePopup}
                        placeName={currentPlaceName}
                        placeAddress={currentPlaceAddress}
                        onInteract={() => { suppressMapClickRef.current = true; setTimeout(() => { suppressMapClickRef.current = false }, 300) }}
                    /> : null}
                /> : <React.Fragment>
                <MapLibreComponent
                    ref={mapRef}
                    viewState={{ ...viewState, ...toDisplay(viewState) }}
                    onMove={(evt) => {
                        const canonicalView = { ...evt.viewState, ...fromDisplay(evt.viewState) }
                        setViewState(canonicalView)
                    }}
                    onMoveEnd={(evt) => saveViewState({ ...evt.viewState, ...fromDisplay(evt.viewState) })}
                    onLoad={handleMapLoad}
                    onClick={handleMapClick}
                    mapboxAccessToken=""
                    mapStyle={mapStyle}
                    reuseMaps
                    attributionControl={true}
                    logoPosition="bottom-left"
                    doubleClickZoom={false}
                    style={{ 
                        width: '100%', 
                        height: '100%'
                    }}
                    onError={(event) => {
                        console.error('Map error:', event)
                        setError('地图初始化失败')
                    }}
                >
                {/* Render connection lines */}
                <ConnectionLines markers={visibleMarkers} zoom={viewState.zoom} basemap={basemap} routeProvider={routeProvider} />

                {/* Render existing markers - 添加安全检查 */}
                {visibleMarkers && visibleMarkers.length > 0 && visibleMarkers.map((marker) => {
                    // 确保marker有必要的属性
                    if (!marker || !marker.id || !marker.coordinates) {
                        return null
                    }

                    return (
                        <MapboxMarker
                            key={marker.id}
                            longitude={toDisplay(marker.coordinates).longitude}
                            latitude={toDisplay(marker.coordinates).latitude}
                            anchor="center"
                        >
                            <MapMarker
                                marker={marker}
                                isSelected={marker.id === selectedMarkerId}
                                onClick={() => handleMarkerClick(marker.id)}
                                zoom={viewState.zoom}
                            />
                        </MapboxMarker>
                    )
                })}

                {searchOverlayResults.map(result => <MapboxMarker
                    key={`search:${searchResultKey(result)}`}
                    longitude={toDisplay(result.coordinates).longitude}
                    latitude={toDisplay(result.coordinates).latitude}
                    anchor="center"
                    style={{ zIndex: selectedSearchKey === searchResultKey(result) ? 125 : 105 }}
                >
                    <SearchResultMarker result={result} selected={selectedSearchKey === searchResultKey(result)} onClick={() => handleFabResultClick(result)} />
                </MapboxMarker>)}

                {/* Render popup：仅用于空白处添加标记，不再用于标记操作 */}
                {isPopupOpen && popupCoordinates && (
                    <MapPopup
                        coordinates={popupCoordinates}
                        basemap={basemap}
                        selectedMarkerId={selectedMarkerId}
                        hideAssignment={searchOpen}
                        onAddMarker={handleAddMarker}
                        onViewMarker={handleViewMarker}
                        onDeleteMarker={handleDeleteMarker}
                        onClose={closePopup}
                        placeName={currentPlaceName}
                        placeAddress={currentPlaceAddress}
                        onInteract={() => {
                            suppressMapClickRef.current = true
                            setTimeout(() => { suppressMapClickRef.current = false }, 300)
                        }}
                    />
                )}
                </MapLibreComponent>
                </React.Fragment>}

            {/* Keep overlay identity distinct from the sibling SDK map to prevent remount loops. */}
            {mapInitialized && !searchOpen && !addMarkerEnabled && activeView.mode !== 'overview' &&
                <ItineraryMapCards key={`itinerary:${basemap}`} createAnchor={createItineraryAnchor} project={projectItineraryPoint} routePaths={itineraryRoutePaths} subscribe={subscribeItineraryCamera} onMarkerClick={handleMarkerClick} onFitMarkers={handleFitMarkers} />}

            {/* 新增标记弹窗 */}
            <AddMarkerModal
                coordinates={addMarkerModal.coordinates || { latitude: 0, longitude: 0 }}
                isOpen={addMarkerModal.isOpen}
                onClose={closeAddMarkerModal}
                onSave={handleSaveNewMarker}
                placeName={addMarkerModal.placeName || undefined}
                placeAddress={currentPlaceAddress}
                placeReferences={addMarkerModal.placeReferences}
            />

            {/* 编辑标记弹窗 */}
            <EditMarkerModal
                marker={editMarkerModal.markerId ? markers.find(m => m.id === editMarkerModal.markerId) || null : null}
                isOpen={editMarkerModal.isOpen}
                onClose={closeEditMarkerModal}
                onSave={handleUpdateMarker}
            />

        </div>
    )
}


// MapLibre 地图组件包装器
interface MapLibreComponentProps {
    ref: React.Ref<MapRef>
    viewState: ViewState
    onMove: (evt: any) => void
    onMoveEnd: (evt: any) => void
    onLoad: () => void
    onClick: (event: any) => void
    mapboxAccessToken: string
    mapStyle: ReturnType<typeof createBasemapStyle>
    reuseMaps: boolean
    attributionControl: boolean
    logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right"
    doubleClickZoom: boolean
    style: React.CSSProperties
    onError: (event: any) => void
    children: React.ReactNode
}

const MapLibreComponent = React.forwardRef<MapRef, MapLibreComponentProps>((props, ref) => {
    const { viewState, ...restProps } = props
    return (
        <ReactMapProvider>
            <Map
                ref={ref}
                {...restProps}
                {...viewState}
            />
        </ReactMapProvider>
    )
})

MapLibreComponent.displayName = 'MapLibreComponent'
