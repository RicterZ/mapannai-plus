'use client'

import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'

import { AMapRenderer, MapRendererHandle } from './amap-renderer'
import { createBasemapStyle, toMapCoordinates, fromMapCoordinates } from '@/lib/map/basemap'
import { config } from '@/lib/config'
import { isInChina } from '@/lib/coord-transform'
import { installZoomThresholdBackdoor } from '@/lib/zoom-threshold'
import { searchService } from '@/lib/api/search-service'
import { useMapStore } from '@/store/map-store'
import { MarkerCoordinates } from '@/types/marker'
import type { BasemapProviderType } from '@/types/map-provider'
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import { MapMarker } from './map-marker'
import { MapPopup } from './map-popup'
import { ConnectionLines } from './connection-lines'
import { AddMarkerModal } from '@/components/modal/add-marker-modal'
import { EditMarkerModal } from '@/components/modal/edit-marker-modal'
import { LeftSidebar } from '@/components/sidebar/left-sidebar'
import { Sidebar } from '@/components/sidebar/sidebar'
import { ViewModeBanner } from '@/components/map/view-mode-banner'
import { cn } from '@/utils/cn'
import { MarkerIconType } from '@/types/marker'
import Map, { Marker as MapboxMarker, MapRef, ViewState, MapProvider as ReactMapProvider } from 'react-map-gl/maplibre'

// 根据地图提供者导入相应的样式
import 'maplibre-gl/dist/maplibre-gl.css'

export const AbstractMap = ({ renderer, amapJsKey, amapSecurityCode }: { renderer: BasemapProviderType; amapJsKey: string; amapSecurityCode: string }) => {
    const mapRef = useRef<any>(null)
    const suppressMapClickRef = useRef(false) // popup 内操作后短暂屏蔽地图点击
    const [error, setError] = useState<string | null>(null)
    const [mapInitialized, setMapInitialized] = useState(false)
    const [loadingRetryCount, setLoadingRetryCount] = useState(0)
    const [dataLoaded, setDataLoaded] = useState(false)

    const basemap = renderer
    const isAmap = basemap === 'amap'
    const amapRef = useRef<MapRendererHandle>(null)
    const flyMap = useCallback((options: { center: [number, number]; zoom?: number; duration?: number; offset?: [number, number] }) => {
        if (isAmap) amapRef.current?.flyTo(options)
        else mapRef.current?.flyTo(options)
    }, [isAmap])
    const toDisplay = useCallback((c: { longitude: number; latitude: number }) => toMapCoordinates(c, basemap), [basemap])
    const fromDisplay = useCallback((c: { longitude: number; latitude: number }) => fromMapCoordinates(c, basemap), [basemap])
    const mapStyle = useMemo(() => createBasemapStyle(typeof window !== 'undefined' ? window.location.origin : ''), [basemap])
    // 存储地点名称，用于更新 popup title
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
    const [addMarkerEnabled, setAddMarkerEnabled] = useState(() => {
        if (typeof window === 'undefined') return true
        const saved = localStorage.getItem('addMarkerEnabled')
        return saved === null ? false : saved === 'true'
    })

    const toggleAddMarker = () => {
        setAddMarkerEnabled(v => {
            const next = !v
            localStorage.setItem('addMarkerEnabled', String(next))
            // 切换到编辑模式（next=true）时关闭右侧 sidebar
            if (next) {
                useMapStore.getState().closeSidebar()
            }
            return next
        })
    }

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

    // 右下角搜索栏状态
    const [fabQuery, setFabQuery] = useState('')
    const [fabResults, setFabResults] = useState<any[]>([])
    const [fabQueryError, setFabQueryError] = useState('')
    const [isSearching, setIsSearching] = useState(false)

    // 用户定位状态
    type GeoState = 'idle' | 'loading' | 'active'
    const [geoState, setGeoState] = useState<GeoState>('idle')
    const geoWatchRef = useRef<number | null>(null)
    const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null)
    const hasGeolocation = typeof navigator !== 'undefined' && 'geolocation' in navigator

    const handleGeoClick = useCallback(() => {
        if (!hasGeolocation) return
        if (geoState === 'loading') return

        if (geoState === 'active' && userLocation) {
            // 已定位，重新飞到当前位置
            flyMap({ center: [userLocation.lng, userLocation.lat], zoom: 15, duration: 800 })
            return
        }

        setGeoState('loading')
        if (geoWatchRef.current !== null) {
            navigator.geolocation.clearWatch(geoWatchRef.current)
        }
        geoWatchRef.current = navigator.geolocation.watchPosition(
            (pos) => {
                const loc = { lng: pos.coords.longitude, lat: pos.coords.latitude }
                setUserLocation(loc)
                setGeoState(prev => {
                    if (prev === 'loading') {
                        flyMap({ center: [loc.lng, loc.lat], zoom: 15, duration: 800 })
                    }
                    return 'active'
                })
            },
            (err) => {
                if (err.code === err.PERMISSION_DENIED) {
                    // 用户明确拒绝权限，才提示
                    setGeoState('idle')
                    toast.error('无法获取位置，请检查定位权限')
                }
                // POSITION_UNAVAILABLE / TIMEOUT：信号抖动，静默处理
                // 已有位置时保持 active；否则退回 idle
                else {
                    setGeoState(prev => prev === 'active' ? 'active' : 'idle')
                }
            },
            { enableHighAccuracy: true, timeout: 10000 }
        )
    }, [geoState, userLocation, hasGeolocation, flyMap])

    const {
        markers,
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

    // 监听标记同步失败事件
    useEffect(() => {
        const handleSyncFailed = () => {
            toast.error('标记保存失败，请检查网络后重试', { duration: 5000 })
        }
        window.addEventListener('syncMarkerFailed', handleSyncFailed)
        return () => window.removeEventListener('syncMarkerFailed', handleSyncFailed)
    }, [])

    // 自定义关闭标记详情函数
    const handleCloseSidebar = useCallback(() => {
        // 发送事件通知侧边栏重置添加模式
        const resetAddModeEvent = new CustomEvent('resetAddMode')
        window.dispatchEvent(resetAddModeEvent)

        closeSidebar()
    }, [closeSidebar])

    // 地图初始化成功后设置状态
    const handleMapLoad = useCallback(() => {
        setMapInitialized(true)
        setError(null)
    }, [])

    // 监听跳转到中心的事件
    useEffect(() => {
        const handleJumpToCenter = (event: CustomEvent) => {
            const { coordinates, zoom } = event.detail
            if (mapRef.current || amapRef.current) {
                flyMap({ center: [coordinates.longitude, coordinates.latitude], zoom, duration: 2000 })
            }
        }

        window.addEventListener('jumpToCenter', handleJumpToCenter as EventListener)
        return () => {
            window.removeEventListener('jumpToCenter', handleJumpToCenter as EventListener)
        }
    }, [flyMap])

    // 根据两点距离计算 flyTo 时长：>=200km → 3500ms，<=10km → 2000ms，线性插值
    const flyDuration = useCallback((to: { longitude: number; latitude: number }): number => {
        const R = 6371 // 地球半径 km
        const lat1 = viewState.latitude * Math.PI / 180
        const lat2 = to.latitude * Math.PI / 180
        const dLat = (to.latitude - viewState.latitude) * Math.PI / 180
        const dLon = (to.longitude - viewState.longitude) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
        const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        const t = Math.min(1, Math.max(0, (km - 10) / (200 - 10)))
        return Math.round(2000 + t * 1500)
    }, [viewState.latitude, viewState.longitude])

    // 地图flyTo功能
    const handleFlyTo = useCallback((coordinates: { longitude: number; latitude: number }, zoom?: number) => {
        if (mapRef.current || amapRef.current) {
            // popup 显示在标记下方，标记上移让 popup 视觉居中（offset 负 y = 目标点在视口中心上方）
            flyMap({ center: [coordinates.longitude, coordinates.latitude], offset: [0, -80], zoom, duration: flyDuration(coordinates) })
        }
    }, [flyDuration, flyMap])

    // 右下角搜索：防抖自动搜索（输入≥2字）
    useEffect(() => {
        const trimmedQuery = fabQuery.trim()
        
        // 如果查询为空，清除结果
        if (!trimmedQuery) {
            setFabResults([])
            setFabQueryError('')
            setIsSearching(false)
            return
        }
        
        // 如果字符数少于3个，不进行搜索
        if (trimmedQuery.length < 2) {
            setFabResults([])
            setFabQueryError('')
            setIsSearching(false)
            return
        }
        
        // 防抖：延迟500ms后执行搜索
        const searchTimeout = setTimeout(async () => {
            try {
                setIsSearching(true)
                setFabQueryError('')
                const results = await searchService.searchPlaces(trimmedQuery, 10, 'zh-CN', 'CN')
                setFabResults(results)
            } catch (e) {
                setFabQueryError(e instanceof Error ? e.message : '搜索失败，请稍后再试')
                setFabResults([])
            } finally {
                setIsSearching(false)
            }
        }, 500)
        
        // 清理定时器
        return () => {
            clearTimeout(searchTimeout)
        }
    }, [fabQuery])

    const handleFabResultClick = useCallback((result: any) => {
        if (!result?.coordinates) return
        
        // 清除之前的地点名称和地址，避免显示缓存的结果
        setCurrentPlaceName(undefined)
        setCurrentPlaceAddress(undefined)
        
        // 异步获取 placeId（不阻塞主流程）
        getPlaceIdAsync({
            latitude: result.coordinates.latitude,
            longitude: result.coordinates.longitude
        })
        
        // 根据搜索结果类型智能调整缩放级别
        let zoomLevel = 16 // 默认缩放级别
        
        // 如果搜索结果名称包含特定关键词，调整缩放级别
        const name = result.name?.toLowerCase() || ''
        
        if (name.includes('城市') || name.includes('市') || name.includes('县') || name.includes('区')) {
            // 城市级别，使用较小的缩放
            zoomLevel = 12
        } else if (name.includes('国家') || name.includes('省') || name.includes('州')) {
            // 国家/省级别，使用更小的缩放
            zoomLevel = 8
        } else if (name.includes('街道') || name.includes('路') || name.includes('街')) {
            // 街道级别，使用较大的缩放
            zoomLevel = 18
        } else if (name.includes('建筑') || name.includes('大厦') || name.includes('商场') || name.includes('酒店')) {
            // 具体建筑，使用最大的缩放
            zoomLevel = 19
        } else {
            // 默认地点，使用中等缩放
            zoomLevel = 16
        }
        
        // 延迟跳转，确保结果列表收起
        setTimeout(() => {
            handleFlyTo({ longitude: result.coordinates.longitude, latitude: result.coordinates.latitude }, zoomLevel)

            // 自动弹出添加标记的 popup（先清除选中标记，避免显示旧内容）
            setTimeout(() => {
                selectMarker(null)
                openPopup({
                    latitude: result.coordinates.latitude,
                    longitude: result.coordinates.longitude
                })
            }, 500)
        }, 100)
    }, [handleFlyTo, openPopup])

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
            } else {
                // 地图未初始化时，可能是严重错误
                setError(storeError)
                const timer = setTimeout(() => {
                    clearError()
                    setError(null)
                }, 5000)
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
            
            if (result.success && result.data) {
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
        // 直接从store获取最新状态，避免闭包中的旧状态
        const currentState = useMapStore.getState()
        const currentSidebarOpen = currentState.interactionState.isSidebarOpen
        const currentSelectedMarkerId = currentState.interactionState.selectedMarkerId

        try {
            // Prevent map click when clicking on markers
            if (event.originalEvent?.target &&
                (event.originalEvent.target as HTMLElement).closest('.map-marker')) {
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
        try {
            const marker = markers.find(m => m.id === markerId)
            if (!marker) return

            // 检查是否处于添加模式 - 通过自定义事件获取状态
            let isAddingMode = false
            const checkEvent = new CustomEvent('checkAddingMode', {
                detail: { callback: (result: boolean) => { isAddingMode = result } }
            })
            window.dispatchEvent(checkEvent)

            // 等待回调执行
            setTimeout(() => {
                if (isAddingMode) {
                    closePopup()
                    // 触发添加标记事件
                    const addEvent = new CustomEvent('addMarkerToChain', {
                        detail: { markerId }
                    })
                    window.dispatchEvent(addEvent)
                    return
                }

                // 选中标记 + 弹出 popup（携带标记坐标，显示操作按钮）
                selectMarker(markerId)
                openPopup(marker.coordinates)
                // 激活该标记所属的 day 连线
                const { tripDays, setHighlightedDay, activeView } = useMapStore.getState()
                if (activeView.mode !== 'day') {
                    const day = tripDays.find(d => d.markerIds.includes(markerId))
                    setHighlightedDay(day?.id ?? null)
                }
            }, 0)
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
            openAddMarkerModal(popupCoordinates, placeName)
        } catch (err) {
            console.error('Add marker error:', err)
        }
    }, [popupCoordinates, openAddMarkerModal, closePopup])

    const handleViewMarker = useCallback((markerId: string) => {
        try {
            selectMarker(markerId)
            openSidebar()
        } catch (err) {
            console.error('View marker error:', err)
        }
    }, [selectMarker, openSidebar])

    const handleDeleteMarker = useCallback((markerId: string) => {
        try {
            const { deleteMarker } = useMapStore.getState()
            deleteMarker(markerId)
            closePopup()
            toast.success('标记已删除')
        } catch (err) {
            console.error('Delete marker error:', err)
        }
    }, [closePopup])

    const handleSaveNewMarker = useCallback(async (data: {
        coordinates: MarkerCoordinates
        name: string
        iconType: MarkerIconType
        address?: string
    }) => {
        try {
            const { activeView: view } = useMapStore.getState()
            const tripId = view.tripId
            const dayId = view.dayId

            await createMarkerFromModal({
                ...data,
                // Day/Trip 模式：等 API 返回真实 ID 后再归属，避免 tempId 污染
                onSynced: tripId && dayId ? async (realMarkerId) => {
                    try {
                        await addMarkerToDay(tripId, dayId, realMarkerId)
                        toast.success('标记已创建并加入今天行程')
                    } catch {
                        toast.success('标记已创建')
                    }
                } : undefined,
            })

            // 没有旅行模式时只提示创建成功（onSynced 为空时执行）
            if (!tripId || !dayId) {
                // toast 由 add-marker-modal 已处理，无需重复
            }
        } catch (err) {
            console.error('Save new marker error:', err)
        }
    }, [createMarkerFromModal, addMarkerToDay])

    const handleUpdateMarker = useCallback((data: {
        markerId: string
        title?: string
        headerImage?: string
        markdownContent: string
        iconType?: MarkerIconType
    }) => {
        try {
            updateMarkerFromModal(data)
        } catch (err) {
            console.error('Update marker error:', err)
        }
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
            {/* 数据加载指示器（非阻塞） */}
            {isLoading && (
                <div className="absolute top-4 right-4 z-50 bg-blue-600 text-white px-3 py-2 rounded-md shadow-lg">
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
            <div className="absolute left-4 z-50" style={{ top: 'calc(env(safe-area-inset-top) + env(safe-area-inset-top) + 12px)' }}>
                <button
                    onClick={toggleLeftSidebar}
                    className={cn(
                        'w-12 h-12 rounded-full shadow-lg border border-gray-200 bg-white',
                        'flex items-center justify-center',
                        'hover:bg-gray-50 transition-colors duration-150',
                        'focus:outline-none touch-manipulation'
                    )}
                    aria-label="打开标记列表"
                    title="打开标记列表"
                >
                    <svg className="w-[18px] h-[18px] text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2,7 L8,8.5 L8,19.5 L2,18 Z" />
                        <path d="M8,8.5 L16,6 L16,17 L8,19.5 Z" />
                        <path d="M16,6 L22,8 L22,19 L16,17 Z" />
                    </svg>
                </button>
            </div>

            {/* 右上角：添加标记开关 — 已移至左侧 sidebar */}

            {/* 视图模式面包屑 Banner */}
            <ViewModeBanner />

            {/* 左侧边栏 */}
            <LeftSidebar onFlyTo={handleFlyTo} addMarkerEnabled={addMarkerEnabled} onToggleAddMarker={toggleAddMarker} />

            {/* 右侧详情栏 */}
            <Sidebar />

            {/* 地图组件 */}
                {isAmap ? <AMapRenderer
                    ref={amapRef}
                    apiKey={amapJsKey}
                    securityCode={amapSecurityCode}
                    viewState={viewState}
                    markers={visibleMarkers}
                    selectedMarkerId={selectedMarkerId}
                    popupCoordinates={isPopupOpen ? popupCoordinates : null}
                    userLocation={userLocation}
                    onMove={next => { setViewState(previous => ({ ...previous, ...next })); saveViewState(next) }}
                    onLoad={handleMapLoad}
                    onClick={(coordinates, originalEvent) => handleMapClick({ lngLat: { lng: coordinates.longitude, lat: coordinates.latitude }, originalEvent, canonical: true })}
                    onMarkerClick={handleMarkerClick}
                    onError={error => { console.error('AMap error:', error); setError(error.message) }}
                    popup={isPopupOpen && popupCoordinates ? <MapPopup
                        coordinates={popupCoordinates}
                        basemap="amap"
                        embedded
                        selectedMarkerId={selectedMarkerId}
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
                        saveViewState(canonicalView)
                    }}
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
                <ConnectionLines markers={visibleMarkers} zoom={viewState.zoom} basemap={basemap} />

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

                {/* Render popup：仅用于空白处添加标记，不再用于标记操作 */}
                {isPopupOpen && popupCoordinates && (
                    <MapPopup
                        coordinates={popupCoordinates}
                        basemap={basemap}
                        selectedMarkerId={selectedMarkerId}
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
                {/* 用户当前位置蓝点 */}
                {userLocation && (
                    <MapboxMarker longitude={toDisplay({ longitude: userLocation.lng, latitude: userLocation.lat }).longitude} latitude={toDisplay({ longitude: userLocation.lng, latitude: userLocation.lat }).latitude} anchor="center">
                        <div className="relative flex items-center justify-center">
                            <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-md" />
                        </div>
                    </MapboxMarker>
                )}
                </MapLibreComponent>
                </React.Fragment>}

            {/* 右下角：搜索栏 */}
            <div className="fixed bottom-6 right-4 left-4 lg:left-auto lg:w-72 z-30 flex flex-col items-stretch lg:items-end gap-2">
                {/* 搜索结果列表（向上弹出，与输入框等宽） */}
                {fabResults.length > 0 && (
                    <div className="w-full lg:w-72 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-scale-in">
                        <div className="max-h-64 overflow-y-auto custom-scrollbar">
                            {fabResults.map((r: any, idx: number) => (
                                <button
                                    key={`${r.name}-${idx}`}
                                    onClick={() => handleFabResultClick(r)}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left border-b border-gray-50 last:border-0"
                                >
                                    <span className="text-blue-500 flex-shrink-0">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">{r.name}</div>
                                        {r.address && <div className="text-xs text-gray-400 truncate mt-0.5">{r.address}</div>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 搜索输入框 + 定位按钮 同一排 */}
                <div className="flex items-center gap-2">
                    <div className="relative flex-1 lg:w-72 lg:flex-none">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            {isSearching ? (
                                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            )}
                        </div>
                        <input
                            type="text"
                            value={fabQuery}
                            onChange={e => {
                                setFabQuery(e.target.value)
                                if (fabQueryError) setFabQueryError('')
                                if (!e.target.value.trim()) setFabResults([])
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Escape') { setFabQuery(''); setFabResults([]) }
                                if (e.key === 'Enter' && fabResults.length > 0) handleFabResultClick(fabResults[0])
                            }}
                            placeholder="搜索地点…"
                            className="w-full lg:w-72 h-12 pl-9 pr-8 bg-white rounded-[14px] shadow-lg border border-gray-200 text-sm placeholder-gray-400 focus:outline-none transition-all"
                        />
                        {fabQuery && !isSearching && (
                            <button
                                onClick={() => { setFabQuery(''); setFabResults([]) }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* 定位按钮 — PWA only */}
                    {hasGeolocation && (
                        <button
                            onClick={handleGeoClick}
                            className="w-12 h-12 rounded-full shadow-lg border flex-shrink-0 flex items-center justify-center bg-white border-gray-200 text-gray-500 hover:bg-gray-50 focus:outline-none touch-manipulation transition-colors duration-150"
                            aria-label="定位到当前位置"
                            title="定位到当前位置"
                        >
                            {geoState === 'loading' ? (
                                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    {/* 外圆 */}
                                    <circle cx="12" cy="12" r="6" />
                                    {/* 中心点 */}
                                    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                                    {/* 十字臂 */}
                                    <line x1="12" y1="2"  x2="12" y2="6" />
                                    <line x1="12" y1="18" x2="12" y2="22" />
                                    <line x1="2"  y1="12" x2="6"  y2="12" />
                                    <line x1="18" y1="12" x2="22" y2="12" />
                                </svg>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* 新增标记弹窗 */}
            <AddMarkerModal
                coordinates={addMarkerModal.coordinates || { latitude: 0, longitude: 0 }}
                isOpen={addMarkerModal.isOpen}
                onClose={closeAddMarkerModal}
                onSave={handleSaveNewMarker}
                placeName={addMarkerModal.placeName || undefined}
                placeAddress={currentPlaceAddress}
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
