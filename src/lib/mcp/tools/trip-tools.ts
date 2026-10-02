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
} from '@/lib/db/trip-service'
import {
    getMarkerById,
    upsertMarker,
    findNearbyMarker,
    generateCoordinateHash,
} from '@/lib/db/marker-service'
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
                    const totalMarkers = new Set(tripDays.flatMap(d => d.markerIds)).size
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
        '获取单次旅行详情，包含每天的 markerIds 和 chains（每条路线按访问顺序排列）；修改或删除路线前用此工具获取最新链索引',
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
            const day = getDayById(dayId)
            if (!day || day.tripId !== tripId) throw new Error(`天不存在: ${dayId}`)
            if (new Set(markerIds).size !== markerIds.length) throw new Error('行程链中不能重复使用同一个标记 ID')
            const missing = markerIds.filter(id => !getMarkerById(id))
            if (missing.length) throw new Error(`标记不存在: ${missing.join(', ')}`)

            const addedIds = markerIds.filter(id => !day.markerIds.includes(id))
            const updated: TripDay = {
                ...day,
                markerIds: [...day.markerIds, ...addedIds],
                chains: [...(day.chains ?? []), markerIds],
            }
            upsertTripDay(updated)
            return { content: [{ type: 'text', text: JSON.stringify({ dayId, chain: markerIds, addedMarkerIds: addedIds }, null, 2) }] }
        }
    )

    // Existing route indices follow the latest get_trip_detail days[].chains array.
    const chainTarget = {
        tripId: z.string().describe('旅行 ID'),
        dayId: z.string().describe('天 ID'),
        chainIndex: z.number().int().min(0).describe('最新 get_trip_detail 中当天 chains 数组的索引，从 0 开始；界面路线 N 对应 N-1。删除后后续索引会变化'),
    }
    server.tool(
        'update_day_chain',
        '修改已有路线链的地点和访问顺序，传入完整 marker ID 列表；不新增路线或地点。新加入的已有地点自动加入当天，移出的地点仍保留在当天。',
        { ...chainTarget, markerIds: z.array(z.string()).min(2).describe('修改后的完整路线，按访问顺序排列，至少两个不重复的已有地点 ID') },
        async ({ tripId, dayId, chainIndex, markerIds }) => {
            const day = editDayChain(tripId, dayId, chainIndex, markerIds)
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, dayId, chainIndex, markerIds: day.markerIds, chains: day.chains }) }] }
        }
    )
    server.tool(
        'delete_day_chain',
        '删除当天的一条路线链，保留全部地点和当天地点成员，不影响其他路线。删除后后续路线索引前移，继续操作前读取最新行程。',
        chainTarget,
        async ({ tripId, dayId, chainIndex }) => {
            const day = editDayChain(tripId, dayId, chainIndex, null)
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, dayId, deletedChainIndex: chainIndex, markerIds: day.markerIds, chains: day.chains }) }] }
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
