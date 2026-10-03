/**
 * MCP Trip Tools
 * Trip and TripDay management exposed as MCP tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
    getAllTrips,
    getTripById,
    upsertTrip,
    deleteTrip,
    getAllTripDays,
    getTripDays,
    getDayById,
    upsertTripDay,
    editDayChain,
    setTripMarker,
} from '@/lib/db/trip-service'
import {
    getMarkerById,
    upsertMarker,
    findNearbyMarker,
    generateCoordinateHash,
} from '@/lib/db/marker-service'
import { createRouteChain, updateRouteChain, deleteRouteChain } from '@/lib/db/route-chain-service'
import { stopPatchSchema, legPatchSchema } from '@/lib/trips/route-chain-schema'
import { Trip, TripDay } from '@/types/trip'
import { v4 as uuidv4 } from 'uuid'

export function registerTripTools(server: McpServer) {

    // list_trips
    server.tool(
        'list_trips',
        '获取所有旅行列表，包含每次旅行的天数和地点数量',
        {},
        async () => {
            const trips = getAllTrips()
            const days = getAllTripDays()
            const result = trips
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map(trip => {
                    const tripDays = days.filter(d => d.tripId === trip.id)
                    const totalMarkers = new Set([...tripDays.flatMap(d => d.markerIds), ...(trip.markerIds ?? [])]).size
                    return {
                        id: trip.id,
                        name: trip.name,
                        description: trip.description,
                        startDate: trip.startDate,
                        endDate: trip.endDate,
                        dayCount: tripDays.length,
                        markerCount: totalMarkers,
                    }
                })
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }
    )

    // get_trip_detail
    server.tool(
        'get_trip_detail',
        '获取单次旅行详情，旅行 markerIds 是未分配日期的地点；包含每天 markerIds、兼容 chains 和 routeChains（稳定路线ID、stops访问ID及游览时间/时长、legs交通方式/车次号/备注）；修改或删除路线前用此工具获取最新链索引',
        { tripId: z.string().describe('旅行 ID') },
        async ({ tripId }) => {
            const trip = getTripById(tripId)
            if (!trip) throw new Error(`旅行不存在: ${tripId}`)

            const tripDays = getTripDays(tripId)
            const result = { ...trip, days: tripDays }
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }
    )

    // create_trip
    server.tool(
        'create_trip',
        '创建一次新旅行，并根据日期范围自动生成每天的行程（TripDay）',
        {
            name: z.string().describe('旅行名称，例如「东京2024春」'),
            startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('开始日期 YYYY-MM-DD'),
            endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('结束日期 YYYY-MM-DD'),
            description: z.string().optional().describe('旅行备注'),
        },
        async ({ name, startDate, endDate, description }) => {
            if (startDate > endDate) throw new Error('开始日期不能晚于结束日期')
            const now = new Date().toISOString()
            const tripId = `trip_${uuidv4()}`

            const trip: Trip = {
                id: tripId, name, description, startDate, endDate,
                createdAt: now, updatedAt: now,
            }

            const days: TripDay[] = []
            const cursor = new Date(startDate)
            const end = new Date(endDate)
            while (cursor <= end) {
                days.push({
                    id: `day_${uuidv4()}`,
                    tripId,
                    date: cursor.toISOString().slice(0, 10),
                    markerIds: [],
                    chains: [],
                })
                cursor.setDate(cursor.getDate() + 1)
            }

            upsertTrip(trip)
            days.forEach(d => upsertTripDay(d))

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ ...trip, days }, null, 2),
                }],
            }
        }
    )

    // add_day_to_trip
    server.tool(
        'add_day_to_trip',
        '手动为旅行添加一天',
        {
            tripId: z.string().describe('旅行 ID'),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('日期 YYYY-MM-DD'),
            title: z.string().optional().describe('当天自定义标题'),
        },
        async ({ tripId, date, title }) => {
            const day: TripDay = { id: `day_${uuidv4()}`, tripId, date, title, markerIds: [], chains: [] }
            upsertTripDay(day)
            return { content: [{ type: 'text', text: JSON.stringify(day, null, 2) }] }
        }
    )

    server.tool(
        'assign_marker_to_trip',
        '将已有地点收藏到旅行但暂不分配日期，不创建行程日或路线；已属于该旅行某日的地点不能重复加入待分配列表。',
        { tripId: z.string().describe('旅行 ID'), markerId: z.string().describe('已有地点 ID') },
        async ({ tripId, markerId }) => ({ content: [{ type: 'text', text: JSON.stringify(setTripMarker(tripId, markerId, true)) }] })
    )
    server.tool(
        'remove_marker_from_trip',
        '移除旅行中未分配日期的地点归属，保留地点本身，不影响其他旅行或每日安排。',
        { tripId: z.string().describe('旅行 ID'), markerId: z.string().describe('未分配日期的地点 ID') },
        async ({ tripId, markerId }) => ({ content: [{ type: 'text', text: JSON.stringify(setTripMarker(tripId, markerId, false)) }] })
    )

    // assign_marker_to_day
    server.tool(
        'assign_marker_to_day',
        '将已有 marker 加入旅行的某天行程',
        {
            tripId: z.string().describe('旅行 ID'),
            dayId: z.string().describe('天 ID（来自 get_trip_detail）'),
            markerId: z.string().describe('Marker ID'),
        },
        async ({ tripId, dayId, markerId }) => {
            const day = getDayById(dayId)
            if (!day || day.tripId !== tripId) throw new Error(`天不存在: ${dayId}`)

            if (!day.markerIds.includes(markerId)) {
                upsertTripDay({ ...day, markerIds: [...day.markerIds, markerId] })
            }

            return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
        }
    )

    // plan_trip_day
    server.tool(
        'plan_trip_day',
    '旅行规划工具：按名称批量创建地点 marker 并加入旅行的某一天。\n\n【地点名称规则】每个地点名称必须包含城市名，例如「东京 浅草寺」「京都 伏见稻荷」，禁止只写地点简称，避免搜索返回错误地区的同名地点。\n\n【行程合理性校验 - 必须执行】所有地点创建完成后，计算同一天内任意两个成功定位的地点之间的直线距离。若存在两点距离超过 100 公里，必须停止并向用户报告：哪个地点疑似定位错误、其当前坐标是什么、距其他地点多远。不得默默忽略异常坐标继续规划。\n\n【错误处理】若某地点搜索失败（status: error），必须告知用户并建议换一个更精确的名称重试，不应跳过。',
        {
            tripId: z.string().describe('旅行 ID'),
            dayId: z.string().describe('天 ID'),
            provider: z.enum(['google', 'amap']).optional().describe('地点搜索后端，不填使用服务端配置'),
            country: z.string().optional().default('CN').describe('限定搜索国家代码，默认 CN（中国）。规划其他国家时必须修改，例如 JP（日本）、KR（韩国）、US（美国）。填错会导致同名地点定位到错误国家。'),
            places: z.array(z.object({
                name: z.string().describe('地点名称，必须包含城市/区域名，例如「京都 金阁寺」「大阪 心斋桥」，避免只写地点简称'),
                iconType: z.enum(['activity', 'location', 'hotel', 'shopping', 'food', 'landmark', 'park', 'natural', 'culture', 'transit']),
                content: z.string().optional().describe('HTML 格式的描述内容（Tiptap 富文本编辑器输出，支持标题、加粗、斜体、下划线、列表、引用、图片等）'),
            })).min(1).describe('按访问顺序排列的地点列表。所有地点应在合理的同日游览范围内（任意两点距离不超过 100 公里）'),
        },
        async ({ tripId, dayId, country = 'CN', places, provider }) => {
            const day = getDayById(dayId)
            if (!day || day.tripId !== tripId) throw new Error(`天不存在: ${dayId}`)

            const { mapProviderFactory } = await import('@/lib/map/providers')
            const googleProvider = mapProviderFactory.createServiceProvider('search', provider)

            const results = []
            for (const place of places) {
                try {
                    const searchResults = await googleProvider.searchPlaces(place.name, undefined, country)
                    if (!searchResults?.length) throw new Error(`找不到: ${place.name}`)

                    const coordinates = searchResults[0].coordinates
                    const coordinateHash = generateCoordinateHash(coordinates.longitude, coordinates.latitude)
                    const featureId = `coord_${coordinateHash}`

                    const existing = findNearbyMarker(coordinates.longitude, coordinates.latitude, 10)

                    let markerId = featureId
                    if (!existing) {
                        const now = new Date().toISOString()
                        upsertMarker(featureId, coordinates.longitude, coordinates.latitude, {
                            markdownContent: place.content || '',
                            headerImage: null,
                            iconType: place.iconType,
                            next: [],
                            metadata: {
                                id: featureId, title: place.name,
                                description: 'MCP 行程规划', isPublished: true,
                                createdAt: now, updatedAt: now, coordinateHash,
                            },
                        })
                    } else {
                        markerId = existing.id as string
                    }

                    // Append to day (re-read for latest state)
                    const freshDay = getDayById(dayId)!
                    if (!freshDay.markerIds.includes(markerId)) {
                        upsertTripDay({ ...freshDay, markerIds: [...freshDay.markerIds, markerId] })
                    }

                    results.push({ name: place.name, id: markerId, status: existing ? 'existing' : 'created', coordinates })
                } catch (err) {
                    results.push({ name: place.name, id: null, status: 'error', error: err instanceof Error ? err.message : String(err) })
                }
            }

            // Build a single chain from all successfully placed markers (in order)
            const validIds = results.filter(r => r.id).map(r => r.id as string)
            if (validIds.length >= 2) {
                const finalDay = getDayById(dayId)!
                upsertTripDay({ ...finalDay, chains: [...(finalDay.chains ?? []), validIds] })
            }

            return { content: [{ type: 'text', text: JSON.stringify({ dayId, results }, null, 2) }] }
        }
    )

    // create_day_chain
    server.tool(
        'create_day_chain',
        '使用已有标记 ID 按顺序为某天新增一条行程链；不会创建新地点。尚未加入当天的标记会自动加入。',
        {
            tripId: z.string().describe('旅行 ID'),
            dayId: z.string().describe('天 ID（来自 get_trip_detail）'),
            markerIds: z.array(z.string()).min(2).describe('行程链中的标记 ID，按游览顺序排列，至少两个'),
        },
        async ({ tripId, dayId, markerIds }) => {
            const { route, addedMarkerIds } = createRouteChain(tripId, dayId, markerIds)
            return { content: [{ type: 'text', text: JSON.stringify({ dayId, chain: markerIds, addedMarkerIds, routeChain: route }, null, 2) }] }
        }
    )

    // Existing route indices follow the latest get_trip_detail days[].chains array.
    const chainTarget = {
        tripId: z.string().describe('旅行 ID'),
        dayId: z.string().describe('天 ID'),
        chainId: z.string().optional().describe('优先使用 get_trip_detail 中 routeChains 的稳定路线 ID'),
        chainIndex: z.number().int().min(0).optional().describe('兼容旧客户端：chains 数组索引，从0开始。chainId 和 chainIndex 二选一；删除后索引变化'),
    }
    server.tool(
        'update_day_chain',
        '修改已有路线顺序、地点游览安排与路段交通安排。优先传稳定 chainId；省略字段保留，时间/时长/车次号/note传null清除。车次号独立放serviceNumber。计划时长不影响寻路缓存，不自动排程。',
        {
            ...chainTarget,
            markerIds: z.array(z.string()).min(2).optional().describe('可选：修改后的完整地点顺序，至少两个不重复的已有地点ID'),
            stops: z.array(stopPatchSchema).optional().describe('可选：按访问stopId局部修改游览时间、停留分钟数、note'),
            legs: z.array(legPatchSchema).optional().describe('可选：按相邻访问ID修改交通、独立线路/车次号serviceNumber、出发时间、计划分钟数、note；remove=true清除交通安排'),
        },
        async ({ tripId, dayId, chainId, chainIndex, markerIds, stops, legs }) => {
            const day = getDayById(dayId)
            if (!day || day.tripId !== tripId) throw new Error('行程日不存在')
            if ((chainId === undefined) === (chainIndex === undefined)) throw new Error('chainId和chainIndex须二选一')
            const id = chainId ?? day.routeChains?.[chainIndex!]?.id
            if (!id) throw new Error('路线不存在，请查询最新行程')
            const updated = updateRouteChain(tripId, dayId, id, { markerIds, stops, legs })
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, dayId, chainId: id, markerIds: updated.markerIds, chains: updated.chains, routeChains: updated.routeChains }) }] }
        }
    )
    server.tool(
        'delete_day_chain',
        '删除一条路线及其游览/交通安排，保留全部地点和当天成员。优先chainId；兼容chainIndex，删除后后续索引前移。',
        chainTarget,
        async ({ tripId, dayId, chainId, chainIndex }) => {
            if ((chainId === undefined) === (chainIndex === undefined)) throw new Error('chainId和chainIndex须二选一')
            const day = chainId !== undefined ? deleteRouteChain(tripId, dayId, chainId) : editDayChain(tripId, dayId, chainIndex!, null)
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, dayId, deletedChainId: chainId, deletedChainIndex: chainIndex, markerIds: day.markerIds, chains: day.chains, routeChains: day.routeChains }) }] }
        }
    )

    // reorder_day_markers
    server.tool(
        'reorder_day_markers',
        '调整某天行程中 marker 的顺序',
        {
            tripId: z.string().describe('旅行 ID'),
            dayId: z.string().describe('天 ID'),
            markerIds: z.array(z.string()).describe('新的 marker 顺序（完整列表）'),
        },
        async ({ tripId, dayId, markerIds }) => {
            const day = getDayById(dayId)
            if (!day || day.tripId !== tripId) throw new Error(`天不存在: ${dayId}`)
            upsertTripDay({ ...day, markerIds })
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, dayId, markerIds }) }] }
        }
    )

    // delete_trip
    server.tool(
        'delete_trip',
        '删除旅行及其所有天；默认保留地点，可显式同时删除仅属于一个旅行和一个日期的地点，共享地点跳过。',
        { tripId: z.string().describe('旅行 ID'), deleteExclusiveMarkers: z.boolean().optional().default(false).describe('同时删除独占地点，用户明确要求时开启；涉及多个旅行或多个日期的地点保留') },
        async ({ tripId, deleteExclusiveMarkers }) => {
            const days = getTripDays(tripId)
            // ON DELETE CASCADE handles trip_days cleanup automatically
            const result = deleteTrip(tripId, deleteExclusiveMarkers)
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedDays: days.length, ...result }) }] }
        }
    )
}
