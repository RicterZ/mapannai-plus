/**
 * MCP Marker Tools
 * Marker CRUD operations exposed as MCP tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { mapProviderFactory } from '@/lib/map/providers'
import { MarkerIconType } from '@/types/marker'
import {
    getAllMarkers,
    getMarkerById,
    upsertMarker,
    deleteMarker,
    findNearbyMarker,
    generateCoordinateHash,
} from '@/lib/db/marker-service'

async function searchPlaceCoordinates(name: string, country: string = 'CN', provider?: 'google' | 'amap'): Promise<{ latitude: number; longitude: number; address?: string }> {
  const googleProvider = mapProviderFactory.createServiceProvider('search', provider)
  const results = await googleProvider.searchPlaces(name, undefined, country)
  if (!results || results.length === 0) {
    throw new Error(`找不到地点: ${name}`)
  }
  return {
    ...results[0].coordinates,
    address: results[0].address,
  }
}

export function registerMarkerTools(server: McpServer) {
  // list_markers
  server.tool(
    'list_markers',
    '获取地图上所有已保存的 marker（地点标记）列表，包含坐标、标题、图标类型和内容',
    {},
    async () => {
      const featureCollection = getAllMarkers()
      const markers = featureCollection.features
        .filter(f => f.id && f.geometry?.coordinates?.length >= 2)
        .map(f => {
          const props = f.properties || {}
          const meta = props.metadata || {}
          return {
            id: f.id,
            coordinates: {
              latitude: f.geometry.coordinates[1],
              longitude: f.geometry.coordinates[0],
            },
            title: meta.title || '未命名标记',
            iconType: props.iconType || 'location',
            markdownContent: props.markdownContent || '',
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
          }
        })

      return {
        content: [{ type: 'text', text: JSON.stringify(markers, null, 2) }],
      }
    }
  )

  // create_marker
  server.tool(
    'create_marker',
    '按地点名称搜索坐标并在地图上创建一个新的 marker。支持批量创建。【重要】地点名称必须包含城市名（如「东京 浅草寺」），避免定位到错误地区。批量创建同一天行程的地点时，创建完成后必须校验所有地点坐标：若任意两点之间直线距离超过 100 公里，需立即警告用户并说明哪些地点疑似定位错误，不应默默继续。',
    {
      places: z.array(z.object({
        name: z.string().describe('地点名称，必须包含城市名（用于搜索坐标），例如「大阪 道顿堀」「上海 外滩」'),
        iconType: z.enum(['activity', 'location', 'hotel', 'shopping', 'food', 'landmark', 'park', 'natural', 'culture', 'transit'])
          .describe('图标类型'),
        content: z.string().optional().describe('HTML 格式的描述内容（Tiptap 富文本编辑器输出，支持标题、加粗、斜体、下划线、列表、引用、图片等）'),
      })).min(1).describe('要创建的地点列表（支持批量）'),
      provider: z.enum(['google', 'amap']).optional().describe('地点搜索后端，不填使用服务端配置'),
      country: z.string().optional().default('CN').describe('限定搜索国家代码，默认 CN（中国）。规划其他国家时必须修改，例如 JP（日本）、KR（韩国）、US（美国）。填错会导致同名地点定位到错误国家。'),
    },
    async ({ places, country, provider }) => {
      const results = []
      for (const place of places) {
        try {
          const coordinates = await searchPlaceCoordinates(place.name, country, provider)
          const coordinateHash = generateCoordinateHash(coordinates.longitude, coordinates.latitude)
          const featureId = `coord_${coordinateHash}`

          // 检查是否已存在（10米内去重）
          const existing = findNearbyMarker(coordinates.longitude, coordinates.latitude, 10)

          if (existing) {
            results.push({
              id: existing.id,
              name: place.name,
              status: 'existing',
              coordinates: {
                latitude: existing.geometry.coordinates[1],
                longitude: existing.geometry.coordinates[0],
              },
            })
            continue
          }

          const now = new Date()
          const properties = {
            markdownContent: place.content || '',
            headerImage: null,
            address: coordinates.address || null,
            iconType: place.iconType as MarkerIconType,
            metadata: {
              id: featureId,
              title: place.name,
              description: 'MCP 创建的标记',
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
              isPublished: true,
              coordinateHash,
            },
          }

          upsertMarker(featureId, coordinates.longitude, coordinates.latitude, properties)
          results.push({
            id: featureId,
            name: place.name,
            status: 'created',
            coordinates,
          })
        } catch (err) {
          results.push({
            name: place.name,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      }
    }
  )

  // update_marker
  server.tool(
    'update_marker',
    '更新地图上已有 marker 的标题、富文本内容或图标类型',
    {
      markerId: z.string().describe('要更新的 marker ID'),
      title: z.string().optional().describe('新的标题'),
      markdownContent: z.string().optional().describe('新的 HTML 格式内容（Tiptap 富文本编辑器输出，支持标题、加粗、斜体、下划线、列表、引用、图片等）'),
      iconType: z.enum(['activity', 'location', 'hotel', 'shopping', 'food', 'landmark', 'park', 'natural', 'culture', 'transit'])
        .optional().describe('新的图标类型'),
    },
    async ({ markerId, title, markdownContent, iconType }) => {
      const feature = getMarkerById(markerId)
      if (!feature) throw new Error(`未找到 marker: ${markerId}`)

      const coordinates = feature.geometry.coordinates
      const existingProps = feature.properties || {}
      const existingMeta = existingProps.metadata || {}

      const now = new Date()
      const updatedProperties = {
        ...existingProps,
        markdownContent: markdownContent !== undefined ? markdownContent : existingProps.markdownContent,
        iconType: iconType !== undefined ? iconType : existingProps.iconType,
        metadata: {
          ...existingMeta,
          title: title !== undefined ? title : existingMeta.title,
          updatedAt: now.toISOString(),
        },
      }

      upsertMarker(markerId, coordinates[0], coordinates[1], updatedProperties)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, id: markerId, updatedAt: now.toISOString() }, null, 2),
        }],
      }
    }
  )

  // delete_marker
  server.tool(
    'delete_marker',
    '从地图上删除指定的 marker',
    {
      markerId: z.string().describe('要删除的 marker ID'),
    },
    async ({ markerId }) => {
      deleteMarker(markerId)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, deleted: markerId }, null, 2),
        }],
      }
    }
  )
}
