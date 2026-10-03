import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { Marker, MarkerCoordinates, MarkerIconType, MapInteractionState } from '@/types/marker'
import { Trip, TripDay, ActiveView } from '@/types/trip'
import { v4 as uuidv4 } from 'uuid'
import { removeRouteMarker } from '@/lib/trips/route-chain'
import type { RouteChainPatch } from '@/lib/trips/route-chain-schema'
import { fetchWithAuth } from '@/lib/fetch-with-auth'

interface MapStore {
    // State
    markers: Marker[]
    interactionState: MapInteractionState
    isLoading: boolean
    error: string | null

    // 新增弹窗状态
    addMarkerModal: {
        isOpen: boolean
        coordinates: MarkerCoordinates | null
        placeName: string | null
    }

    // 编辑弹窗状态
    editMarkerModal: {
        isOpen: boolean
        markerId: string | null
    }

    // 左侧边栏状态
    leftSidebar: {
        isOpen: boolean
    }

    // 编辑模式状态
    editMode: {
        isEnabled: boolean
    }

    // ── Trip 系统 ──────────────────────────────────
    trips: Trip[]
    tripDays: TripDay[]
    tripsLoaded: boolean
    activeView: ActiveView

    // Actions
    createMarkerFromModal: (data: {
        coordinates: MarkerCoordinates
        name: string
        iconType: MarkerIconType
        address?: string
        onSynced?: (realMarkerId: string) => void
    }) => Promise<string>
    updateMarker: (markerId: string, updates: Partial<Marker>) => void
    updateMarkerFromModal: (data: {
        markerId: string
        title?: string
        headerImage?: string
        markdownContent: string
        iconType?: MarkerIconType
    }) => void
    deleteMarker: (markerId: string) => Promise<void>
    selectMarker: (markerId: string | null) => void

    // Popup actions
    openPopup: (coordinates: MarkerCoordinates, placeName?: string) => void
    closePopup: () => void

    // 新增弹窗 actions
    openAddMarkerModal: (coordinates: MarkerCoordinates, placeName?: string) => void
    closeAddMarkerModal: () => void

    // 编辑弹窗 actions
    openEditMarkerModal: (markerId: string) => void
    closeEditMarkerModal: () => void

    // 左侧边栏 actions
    openLeftSidebar: () => void
    closeLeftSidebar: () => void
    toggleLeftSidebar: () => void

    // 编辑模式 actions
    setEditMode: (enabled: boolean) => void
    toggleEditMode: () => void


    // Sidebar actions
    openSidebar: () => void
    closeSidebar: () => void

    // Editor actions
    updateMarkerContent: (markerId: string, content: { title?: string; headerImage?: string; markdownContent: string }) => void

    // Day highlight actions
    setHighlightedDay: (dayId: string | null) => void

    // Dataset actions
    saveMarkerToDataset: (marker: Marker) => Promise<void>
    loadMarkersFromDataset: () => Promise<void>
    deleteMarkerFromDataset: (markerId: string) => Promise<void>
    clearError: () => void

    setLoading: (loading: boolean) => void

    // ── Trip actions ───────────────────────────────
    loadTripsFromDataset: () => Promise<void>
    setActiveView: (mode: ActiveView['mode'], tripId?: string | null, dayId?: string | null, options?: { focusFirstMarker?: boolean }) => void
    createTrip: (data: { name: string; description?: string; startDate: string; endDate: string }) => Promise<Trip>
    updateTrip: (tripId: string, data: Partial<Trip>) => Promise<void>
    deleteTrip: (tripId: string, deleteExclusiveMarkers?: boolean) => Promise<void>
    createTripDay: (tripId: string, data: { date: string; title?: string }) => Promise<TripDay>
    updateTripDay: (tripId: string, dayId: string, data: Partial<TripDay>) => Promise<void>
    deleteTripDay: (tripId: string, dayId: string, deleteExclusiveMarkers?: boolean) => Promise<void>
    setTripMarker: (tripId: string, markerId: string, add: boolean) => Promise<void>
    addMarkerToDay: (tripId: string, dayId: string, markerId: string) => Promise<void>
    removeMarkerFromDay: (tripId: string, dayId: string, markerId: string) => Promise<void>
    reorderDayMarkers: (tripId: string, dayId: string, newOrder: string[]) => Promise<void>
    updateRouteSchedule: (tripId: string, dayId: string, chainId: string, patch: RouteChainPatch) => Promise<void>
    updateDayChains: (tripId: string, dayId: string, chains: string[][]) => Promise<void>
}

// 检查是否在服务器端API路由中运行
const isServerSideAPIRoute = (): boolean => {
    return typeof window === 'undefined'
}

// 保存标记到 Dataset
const saveMarkerToDataset = async (marker: Marker) => {
    // 如果在服务器端API路由中运行，跳过保存以避免循环调用
    if (isServerSideAPIRoute()) {
        return
    }

    const properties = {
        markdownContent: marker.content.markdownContent,
        headerImage: marker.content.headerImage || null,
        address: marker.content.address || null,
        iconType: marker.content.iconType || 'location',
        metadata: {
            id: marker.id,
            title: marker.content.title || '新标记',
            description: '用户创建的标记',
            createdAt: marker.content.createdAt.toISOString(),
            updatedAt: marker.content.updatedAt.toISOString(),
            isPublished: true,
        },
    }

    const response = await fetchWithAuth(`/api/dataset?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            featureId: marker.id,
            coordinates: marker.coordinates,
            properties,
        }),
    })

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`保存失败: ${errorData.error || response.status}`)
    }

    return response.json()
}

export const useMapStore = create<MapStore>()(
    devtools(
        (set, get) => ({
            // Initial state
            markers: [],
            interactionState: {
                selectedMarkerId: null,
                displayedMarkerId: null,
                isPopupOpen: false,
                isSidebarOpen: false,
                popupCoordinates: null,
                placeName: null,
                highlightedDayId: null,
            },
            isLoading: false,
            error: null,

            // ── Trip 初始状态 ──
            trips: [],
            tripDays: [],
            tripsLoaded: false,
            activeView: { mode: 'overview', tripId: null, dayId: null },

            // 新增弹窗初始状态
            addMarkerModal: {
                isOpen: false,
                coordinates: null,
                placeName: null,
            },

            // 编辑弹窗初始状态
            editMarkerModal: {
                isOpen: false,
                markerId: null,
            },

            // 左侧边栏初始状态
            leftSidebar: {
                isOpen: false,
            },

            // 编辑模式初始状态
            editMode: {
                isEnabled: false,
            },


            // Actions
            createMarkerFromModal: async (data) => {
                try {
                    // 1. 立即创建临时标记（乐观更新）
                    const tempMarkerId = uuidv4()
                    const now = new Date()
                    const tempMarker: Marker = {
                        id: tempMarkerId,
                        coordinates: data.coordinates,
                        content: {
                            id: tempMarkerId,
                            title: data.name,
                            address: data.address,
                            iconType: data.iconType,
                            markdownContent: '',
                            createdAt: now,
                            updatedAt: now,
                        },
                    }

                    // 2. 立即添加到本地状态，用户立即看到标记
                    set(state => ({
                        markers: [...state.markers, tempMarker],
                        addMarkerModal: {
                            isOpen: false,
                            coordinates: null,
                            placeName: null,
                        },
                        interactionState: {
                            ...state.interactionState,
                            selectedMarkerId: null,
                            isSidebarOpen: false,
                            isPopupOpen: false,
                            popupCoordinates: null,
                            placeName: null,
                        },
                    }), false, 'createMarkerFromModal-optimistic')

                    // 3. 异步调用API创建标记（不阻塞UI）
                    const syncMarker = async () => {
                        try {
                            const response = await fetchWithAuth('/api/markers', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    coordinates: data.coordinates,
                                    title: data.name,
                                    iconType: data.iconType,
                                    address: data.address,
                                    content: '',
                                }),
                            })

                            if (!response.ok) {
                                const errorData = await response.json().catch(() => ({}))
                                throw new Error(`创建标记失败: ${errorData.error || response.status}`)
                            }

                            const result = await response.json()

                            // 4. 更新本地标记为服务器返回的最终标记（修复Date类型）
                            set(state => ({
                                markers: state.markers.map(marker =>
                                    marker.id === tempMarkerId
                                        ? {
                                            ...result,
                                            content: {
                                                ...result.content,
                                                title: data.name,
                                                address: data.address,
                                                createdAt: result.content?.createdAt ? new Date(result.content.createdAt) : new Date(),
                                                updatedAt: result.content?.updatedAt ? new Date(result.content.updatedAt) : new Date(),
                                            }
                                        }
                                        : marker
                                ),
                            }), false, 'createMarkerFromModal-sync')

                            // 5. 通知调用者实际 ID（用于 day 归属等后续操作）
                            data.onSynced?.(result.id)

                            return result.id
                        } catch (error) {
                            console.error('同步标记到服务器失败:', error)
                            set(state => ({
                                markers: state.markers.map(marker =>
                                    marker.id === tempMarkerId
                                        ? {
                                            ...marker,
                                            content: {
                                                ...marker.content,
                                                isTemporary: true,
                                                syncError: error instanceof Error ? error.message : '同步失败'
                                            }
                                        }
                                        : marker
                                ),
                            }), false, 'createMarkerFromModal-error')
                            return tempMarkerId
                        }
                    }

                    // 异步执行同步，不阻塞UI
                    syncMarker().catch(() => {
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('syncMarkerFailed'))
                        }
                    })

                    return tempMarkerId
                } catch (error) {
                    console.error('创建标记失败:', error)
                    set({ 
                        error: error instanceof Error ? error.message : '创建标记失败，请稍后重试',
                        addMarkerModal: {
                            isOpen: false,
                            coordinates: null,
                            placeName: null,
                        }
                    })
                    throw error
                }
            },

            updateMarker: (markerId, updates) => {
                set(state => ({
                    markers: state.markers.map(marker =>
                        marker.id === markerId
                            ? { ...marker, ...updates, content: { ...marker.content, updatedAt: new Date() } }
                            : marker
                    ),
                }), false, 'updateMarker')

                // 异步更新到 Dataset
                const updatedMarker = get().markers.find(m => m.id === markerId)
                if (updatedMarker) {
                    get().saveMarkerToDataset(updatedMarker).catch(error => {
                        console.error('更新到 Dataset 失败:', error)
                    })
                }
            },

            updateMarkerFromModal: (data) => {
                const now = new Date()

                set(state => ({
                    markers: state.markers.map(marker =>
                        marker.id === data.markerId
                            ? {
                                ...marker,
                                content: {
                                    ...marker.content,
                                    title: data.title,
                                    headerImage: data.headerImage,
                                    markdownContent: data.markdownContent,
                                    iconType: data.iconType !== undefined ? data.iconType : marker.content.iconType,
                                    updatedAt: now,
                                },
                            }
                            : marker
                    ),
                    editMarkerModal: {
                        isOpen: false,
                        markerId: null,
                    },
                }), false, 'updateMarkerFromModal')

                // 异步保存到 Dataset
                const marker = get().markers.find(m => m.id === data.markerId)
                if (marker) {
                    get().saveMarkerToDataset(marker).catch(error => {
                        console.error('更新到 Dataset 失败:', error)
                        set({ error: '更新标记失败，请稍后重试' })
                    })
                }
            },

            deleteMarker: async (markerId) => {
                // 防止误删旅行/天数据
                if (markerId.startsWith('trip_') || markerId.startsWith('day_')) {
                    console.error('禁止通过 deleteMarker 删除旅行数据:', markerId)
                    return
                }
                await get().deleteMarkerFromDataset(markerId)
                set(state => ({
                    markers: state.markers.filter(marker => marker.id !== markerId),
                    trips: state.trips.map(trip => ({ ...trip, markerIds: trip.markerIds?.filter(id => id !== markerId) })),
                    tripDays: state.tripDays.map(day => ({ ...day, markerIds: day.markerIds.filter(id => id !== markerId), chains: day.chains.map(chain => chain.filter(id => id !== markerId)).filter(chain => chain.length > 0), routeChains: day.routeChains && removeRouteMarker(day.routeChains, markerId) })),
                    interactionState: {
                        ...state.interactionState,
                        selectedMarkerId: state.interactionState.selectedMarkerId === markerId
                            ? null
                            : state.interactionState.selectedMarkerId,
                        isSidebarOpen: false,
                    },
                }), false, 'deleteMarker')

            },

            selectMarker: (markerId) => {
                set(state => ({
                    interactionState: {
                        ...state.interactionState,
                        selectedMarkerId: markerId,
                        highlightedDayId: state.activeView.mode === 'day'
                            ? state.activeView.dayId
                            : markerId ? state.tripDays.find(day => (state.activeView.mode !== 'trip' || day.tripId === state.activeView.tripId) && day.markerIds.includes(markerId))?.id ?? null : state.interactionState.highlightedDayId,
                        displayedMarkerId: markerId !== null ? markerId : state.interactionState.displayedMarkerId,
                        // 不再自动打开边栏，由调用方决定
                    },
                }), false, 'selectMarker')
            },

            openPopup: (coordinates, placeName) => {
                set(state => ({
                    interactionState: {
                        ...state.interactionState,
                        isPopupOpen: true,
                        popupCoordinates: coordinates,
                        placeName: placeName || null,
                    },
                }), false, 'openPopup')
            },

            closePopup: () => {
                set(state => ({
                    interactionState: {
                        ...state.interactionState,
                        isPopupOpen: false,
                        popupCoordinates: null,
                        placeName: null,
                    },
                }), false, 'closePopup')
            },

            // 新增弹窗 actions
            openAddMarkerModal: (coordinates, placeName) => {
                set({
                    addMarkerModal: {
                        isOpen: true,
                        coordinates,
                        placeName: placeName || null,
                    },
                    interactionState: {
                        ...get().interactionState,
                        isPopupOpen: false, // 关闭popup
                        popupCoordinates: null,
                        placeName: placeName || null,
                    },
                }, false, 'openAddMarkerModal')
            },

            closeAddMarkerModal: () => {
                set({
                    addMarkerModal: {
                        isOpen: false,
                        coordinates: null,
                        placeName: null,
                    },
                }, false, 'closeAddMarkerModal')
            },

            // 编辑弹窗 actions
            openEditMarkerModal: (markerId) => {
                set({
                    editMarkerModal: {
                        isOpen: true,
                        markerId,
                    },
                    interactionState: {
                        ...get().interactionState,
                        isPopupOpen: false, // 关闭popup
                        popupCoordinates: null,
                    },
                }, false, 'openEditMarkerModal')
            },

            closeEditMarkerModal: () => {
                set({
                    editMarkerModal: {
                        isOpen: false,
                        markerId: null,
                    },
                }, false, 'closeEditMarkerModal')
            },

            // 左侧边栏 actions
            openLeftSidebar: () => {
                set(state => ({
                    leftSidebar: {
                        isOpen: true,
                    },
                }), false, 'openLeftSidebar')
            },

            closeLeftSidebar: () => {
                set(state => ({
                    leftSidebar: {
                        isOpen: false,
                    },
                }), false, 'closeLeftSidebar')
            },

            toggleLeftSidebar: () => {
                set(state => ({
                    leftSidebar: {
                        isOpen: !state.leftSidebar.isOpen,
                    },
                }), false, 'toggleLeftSidebar')
            },

            // 编辑模式 actions
            setEditMode: (enabled) => {
                set(state => ({
                    editMode: {
                        ...state.editMode,
                        isEnabled: enabled,
                    },
                }), false, 'setEditMode')
            },

            toggleEditMode: () => {
                set(state => ({
                    editMode: {
                        ...state.editMode,
                        isEnabled: !state.editMode.isEnabled,
                    },
                }), false, 'toggleEditMode')
            },

            openSidebar: () => {
                set(state => ({
                    interactionState: {
                        ...state.interactionState,
                        isSidebarOpen: true,
                    },
                }), false, 'openSidebar')
            },

            closeSidebar: () => {
                set(state => ({
                    interactionState: {
                        ...state.interactionState,
                        isSidebarOpen: false,
                    },
                }), false, 'closeSidebar')
            },

            updateMarkerContent: (markerId, content) => {
                set(state => ({
                    markers: state.markers.map(marker =>
                        marker.id === markerId
                            ? {
                                ...marker,
                                content: {
                                    ...marker.content,
                                    title: content.title,
                                    headerImage: content.headerImage,
                                    markdownContent: content.markdownContent,
                                    updatedAt: new Date(),
                                },
                            }
                            : marker
                    ),
                }), false, 'updateMarkerContent')

                // 异步保存到 Dataset
                const marker = get().markers.find(m => m.id === markerId)
                if (marker) {
                    get().saveMarkerToDataset(marker).catch(error => {
                        console.error('保存内容到 Dataset 失败:', error)
                    })
                }
            },

            // 设置某个标记的 next 关系（用于行程链实时渲染）
            // Dataset actions
            saveMarkerToDataset: async (marker) => {
                set({ isLoading: true })
                try {
                    await saveMarkerToDataset(marker)
                } catch (error) {
                    console.error('保存到 Dataset 失败:', error)
                    throw error
                } finally {
                    set({ isLoading: false })
                }
            },

            loadMarkersFromDataset: async () => {
                set({ isLoading: true, error: null })
                try {
                    const response = await fetchWithAuth(`/api/dataset?t=${Date.now()}`)

                    if (!response.ok) {
                        // 根据状态码设置不同的错误信息
                        if (response.status === 404) {
                            throw new Error('数据源未找到')
                        } else if (response.status === 401) {
                            throw new Error('访问权限不足')
                        } else if (response.status >= 500) {
                            throw new Error('服务器错误')
                        } else {
                            throw new Error(`网络错误 (${response.status})`)
                        }
                    }

                    const result = await response.json()
                    if (result.success && result.data?.features && Array.isArray(result.data.features)) {
                        const loadedMarkers: Marker[] = result.data.features
                            .filter((feature: any) => {
                                // 安全检查：确保feature有必要的属性
                                const hasValidId = feature.id || feature.properties?.metadata?.id
                                return feature &&
                                    hasValidId &&
                                    feature.geometry &&
                                    feature.geometry.coordinates &&
                                    Array.isArray(feature.geometry.coordinates) &&
                                    feature.geometry.coordinates.length >= 2 &&
                                    feature.properties &&
                                    feature.properties.featureType !== 'trip' &&
                                    feature.properties.featureType !== 'tripDay'
                            })
                            .map((feature: any) => {
                                try {
                                    // 安全地访问嵌套属性
                                    const coordinates = feature.geometry.coordinates
                                    const properties = feature.properties
                                    const metadata = properties.metadata || {}


                                    // 优先使用feature.id，如果没有则使用metadata.id
                                    const markerId = feature.id || metadata.id || `marker-${Date.now()}-${Math.random()}`

                                    return {
                                        id: markerId,
                                        coordinates: {
                                            latitude: coordinates[1],
                                            longitude: coordinates[0],
                                        },
                                        content: {
                                            id: metadata.id || markerId,
                                            title: metadata.title || '未命名标记',
                                            address: properties.address || undefined,
                                            headerImage: properties.headerImage,
                                            iconType: properties.iconType,
                                            markdownContent: properties.markdownContent || '',
                                            next: properties.next || [],
                                            createdAt: metadata.createdAt ? new Date(metadata.createdAt) : new Date(),
                                            updatedAt: metadata.updatedAt ? new Date(metadata.updatedAt) : new Date(),
                                        },
                                    }
                                } catch (error) {
                                    return null
                                }
                            })
                            .filter((marker: Marker | null): marker is Marker => marker !== null)

                        set({ markers: loadedMarkers, error: null })
                    } else {
                        // 不设置错误，让地图正常显示
                        set({ markers: [], error: null })
                    }
                } catch (error) {
                    console.error('从 Dataset 加载失败:', error)
                    const errorMessage = error instanceof Error ? error.message : '数据加载失败'
                    set({ error: errorMessage })
                    throw error // 抛出错误供调用者处理
                } finally {
                    set({ isLoading: false })
                }

                // 同时加载旅行数据（不阻塞主流程）
                get().loadTripsFromDataset().catch(err => {
                    console.error('加载旅行数据失败:', err)
                })
            },

            deleteMarkerFromDataset: async (markerId: string) => {
                try {
                    const response = await fetchWithAuth(`/api/dataset?featureId=${markerId}`, {
                        method: 'DELETE',
                    })

                    if (!response.ok) {
                        throw new Error(`删除失败: ${response.status}`)
                    }

                } catch (error: any) {
                    console.error('从 Dataset 删除失败:', error)
                    throw error
                }
            },

            clearError: () => {
                set({ error: null }, false, 'clearError')
            },

            // Day highlight actions
            setHighlightedDay: (dayId) => {
                set(state => ({
                    interactionState: {
                        ...state.interactionState,
                        highlightedDayId: dayId,
                    },
                }), false, 'setHighlightedDay')
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading')
            },

            // ── Trip Actions ──────────────────────────────────────────────────

            loadTripsFromDataset: async () => {
                try {
                    const response = await fetchWithAuth('/api/trips')
                    if (!response.ok) throw new Error('加载旅行失败')
                    const data = await response.json()
                    const trips = data.map((t: any) => ({ ...t, days: undefined }))
                    const tripDays = data.flatMap((t: any) => t.days || [])
                    set({ trips, tripDays, tripsLoaded: true }, false, 'loadTripsFromDataset')
                } catch (error) {
                    console.error('loadTripsFromDataset error:', error)
                }
            },

            setActiveView: (mode, tripId = null, dayId = null, options) => {
                set({ activeView: { mode, tripId, dayId, focusFirstMarker: options?.focusFirstMarker ?? true } }, false, 'setActiveView')

                // 同步写 URL hash
                if (typeof window !== 'undefined') {
                    if (mode === 'overview') {
                        window.location.hash = ''
                    } else if (mode === 'trip' && tripId) {
                        window.location.hash = `trip/${tripId}`
                    } else if (mode === 'day' && tripId && dayId) {
                        window.location.hash = `day/${tripId}/${dayId}`
                    }
                }

                // 进入 day 视图时高亮当天连线
                set(state => ({
                    interactionState: {
                        ...state.interactionState,
                        highlightedDayId: mode === 'day' ? dayId : null,
                    },
                }), false, 'setActiveView-highlight')
            },

            createTrip: async (data) => {
                const response = await fetchWithAuth('/api/trips', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                })
                if (!response.ok) throw new Error('创建旅行失败')
                const result = await response.json()
                const trip: Trip = { ...result, days: undefined }
                const days: TripDay[] = result.days || []
                set(state => ({
                    trips: [...state.trips, trip],
                    tripDays: [...state.tripDays, ...days],
                }), false, 'createTrip')
                return trip
            },

            updateTrip: async (tripId, data) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                })
                if (!response.ok) throw new Error('更新旅行失败')
                const { days, ...updated }: Trip & { days?: TripDay[] } = await response.json()
                set(state => ({
                    trips: state.trips.map(t => t.id === tripId ? updated : t),
                    tripDays: days
                        ? state.tripDays.map(d => days.find(day => day.id === d.id) ?? d)
                        : state.tripDays,
                }), false, 'updateTrip')
            },

            deleteTrip: async (tripId, deleteExclusiveMarkers = false) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}?deleteExclusiveMarkers=${deleteExclusiveMarkers}`, { method: 'DELETE' })
                if (!response.ok) throw new Error('删除旅行失败')
                const { deletedMarkerIds = [] }: { deletedMarkerIds?: string[] } = await response.json()

                set(prevState => ({
                    markers: prevState.markers.filter(marker => !deletedMarkerIds.includes(marker.id)),
                    interactionState: deletedMarkerIds.includes(prevState.interactionState.selectedMarkerId || '')
                        ? { ...prevState.interactionState, selectedMarkerId: null, isPopupOpen: false, isSidebarOpen: false } : prevState.interactionState,
                    trips: prevState.trips.filter(t => t.id !== tripId),
                    tripDays: prevState.tripDays.filter(d => d.tripId !== tripId),
                    activeView: prevState.activeView.tripId === tripId
                        ? { mode: 'overview' as const, tripId: null, dayId: null }
                        : prevState.activeView,
                }), false, 'deleteTrip')
            },

            createTripDay: async (tripId, data) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}/days`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                })
                if (!response.ok) throw new Error('新增天失败')
                const day: TripDay = await response.json()
                set(state => ({ tripDays: [...state.tripDays, day] }), false, 'createTripDay')
                return day
            },

            updateTripDay: async (tripId, dayId, data) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}/days/${dayId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                })
                if (!response.ok) throw new Error('更新天失败')
                const updated: TripDay = await response.json()
                set(state => ({
                    tripDays: state.tripDays.map(d => d.id === dayId ? updated : d),
                    trips: state.trips.map(trip => trip.id === tripId ? { ...trip, markerIds: trip.markerIds?.filter(id => !updated.markerIds.includes(id) && !updated.chains.some(chain => chain.includes(id))) } : trip),
                }), false, 'updateTripDay')
            },

            deleteTripDay: async (tripId, dayId, deleteExclusiveMarkers = false) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}/days/${dayId}?deleteExclusiveMarkers=${deleteExclusiveMarkers}`, { method: 'DELETE' })
                if (!response.ok) throw new Error('删除天失败')
                const { trip, days, deletedMarkerIds = [] }: { trip: Trip; days: TripDay[]; deletedMarkerIds?: string[] } = await response.json()
                set(state => ({
                    markers: state.markers.filter(marker => !deletedMarkerIds.includes(marker.id)),
                    interactionState: deletedMarkerIds.includes(state.interactionState.selectedMarkerId || '')
                        ? { ...state.interactionState, selectedMarkerId: null, isPopupOpen: false, isSidebarOpen: false } : state.interactionState,
                    trips: state.trips.map(t => t.id === tripId ? trip : t),
                    tripDays: [...state.tripDays.filter(d => d.tripId !== tripId), ...days],
                    activeView: state.activeView.dayId === dayId
                        ? { mode: 'trip', tripId, dayId: null }
                        : state.activeView,
                }), false, 'deleteTripDay')
            },

            setTripMarker: async (tripId, markerId, add) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}/markers`, {
                    method: add ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markerId }),
                })
                if (!response.ok) throw new Error('更新旅行地点失败')
                const trip: Trip = await response.json()
                set(state => ({ trips: state.trips.map(item => item.id === tripId ? trip : item) }), false, 'setTripMarker')
            },

            addMarkerToDay: async (tripId, dayId, markerId) => {
                const previous = get().tripDays.find(d => d.id === dayId)
                // 1. 立即更新本地 state（optimistic）
                set(state => ({
                    tripDays: state.tripDays.map(d =>
                        d.id === dayId && !d.markerIds.includes(markerId)
                            ? { ...d, markerIds: [...d.markerIds, markerId] }
                            : d
                    ),
                }), false, 'addMarkerToDay-optimistic')

                // 2. 异步持久化到服务端（失败时回滚）
                return fetchWithAuth(`/api/trips/${tripId}/days/${dayId}/markers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ markerId }),
                }).then(res => {
                    if (!res.ok) throw new Error('添加标记到天失败')
                    set(state => ({ trips: state.trips.map(trip => trip.id === tripId ? { ...trip, markerIds: trip.markerIds?.filter(id => id !== markerId) } : trip) }), false, 'assignTripMarker')
                }).catch(error => {
                    // 回滚
                    set(state => ({
                        tripDays: state.tripDays.map(d =>
                            d.id === dayId && !previous?.markerIds.includes(markerId)
                                ? { ...d, markerIds: d.markerIds.filter(id => id !== markerId) }
                                : d
                        ),
                    }), false, 'addMarkerToDay-rollback')
                    throw error
                })
            },

            removeMarkerFromDay: async (tripId, dayId, markerId) => {
                const previous = get().tripDays.find(d => d.id === dayId)
                // 1. 立即更新本地 state（optimistic）
                set(state => ({
                    tripDays: state.tripDays.map(d =>
                        d.id === dayId
                            ? { ...d, markerIds: d.markerIds.filter(id => id !== markerId), chains: d.chains.map(chain => chain.filter(id => id !== markerId)).filter(chain => chain.length > 0), routeChains: d.routeChains && removeRouteMarker(d.routeChains, markerId) }
                            : d
                    ),
                }), false, 'removeMarkerFromDay-optimistic')

                // 2. 异步持久化到服务端（失败时回滚）
                return fetchWithAuth(`/api/trips/${tripId}/days/${dayId}/markers`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ markerId }),
                }).then(res => {
                    if (!res.ok) throw new Error('从天移除标记失败')
                }).catch(error => {
                    // 回滚
                    set(state => ({
                        tripDays: state.tripDays.map(d =>
                            d.id === dayId && previous
                                ? previous
                                : d
                        ),
                    }), false, 'removeMarkerFromDay-rollback')
                    throw error
                })
            },

            reorderDayMarkers: async (tripId, dayId, newOrder) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}/days/${dayId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ markerIds: newOrder }),
                })
                if (!response.ok) throw new Error('重排顺序失败')
                set(state => ({
                    tripDays: state.tripDays.map(d =>
                        d.id === dayId ? { ...d, markerIds: newOrder } : d
                    ),
                }), false, 'reorderDayMarkers')
            },

            updateRouteSchedule: async (tripId, dayId, chainId, patch) => {
                const response = await fetchWithAuth(`/api/trips/${tripId}/days/${dayId}/chains/${chainId}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
                })
                const result = await response.json()
                if (!response.ok) throw new Error(result.error || '保存安排失败')
                set(state => ({ tripDays: state.tripDays.map(day => day.id === dayId ? result as TripDay : day) }), false, 'updateRouteSchedule')
            },

            updateDayChains: async (tripId, dayId, chains) => {
                const previous = get().tripDays.find(d => d.id === dayId)?.chains ?? []
                // Optimistic update
                set(state => ({
                    tripDays: state.tripDays.map(d =>
                        d.id === dayId ? { ...d, chains } : d
                    ),
                }), false, 'updateDayChains-optimistic')

                try {
                const response = await fetchWithAuth(`/api/trips/${tripId}/days/${dayId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chains }),
                })
                if (!response.ok) throw new Error('更新链路失败')
                const updatedDay: TripDay = await response.json()
                set(state => ({ tripDays: state.tripDays.map(day => day.id === dayId ? updatedDay : day) }), false, 'updateDayChains-confirmed')
                const assignedIds = new Set(chains.flat())
                set(state => ({ trips: state.trips.map(trip => trip.id === tripId ? { ...trip, markerIds: trip.markerIds?.filter(id => !assignedIds.has(id)) } : trip) }), false, 'updateDayChains-tripPool')
                } catch (error) {
                    set(state => ({ tripDays: state.tripDays.map(d => d.id === dayId && d.chains === chains ? { ...d, chains: previous } : d) }), false, 'updateDayChains-rollback')
                    throw error
                }
            },
        }),
        {
            name: 'map-store',
        }
    )
)
