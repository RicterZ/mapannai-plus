import { transportModeSchema } from '@/lib/trips/route-chain-schema'
/**
 * MCP Search & Directions Tools
 * Place search, place details, and walking directions exposed as MCP tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSavedDirection } from '@/lib/map/direction-service'
import { mapProviderFactory } from '@/lib/map/providers'

export function registerSearchTools(server: McpServer) {
  // search_places
  server.tool(
    'search_places',
    '使用所选搜索后端搜索地点，返回坐标、地址、评分等基础信息。【重要】搜索词必须带上城市名以提高精度，例如「东京 浅草寺」「京都 金阁寺」，而非只写「浅草寺」。必须传入 country 参数以限定搜索范围，避免返回错误国家的同名地点。',
    {
      provider: z.enum(['google', 'amap']).optional().describe('搜索后端，不填使用服务端配置'),
      query: z.string().describe('搜索关键词，必须包含城市名，例如「东京 浅草寺」「大阪 道顿堀」「北京 故宫」'),
      limit: z.number().int().min(1).max(10).optional().default(5).describe('返回结果数量（默认 5）'),
      country: z.string().optional().default('CN').describe('限定搜索国家代码，默认 CN（中国）。规划其他国家时必须修改，例如 JP（日本）、KR（韩国）、US（美国）。填错会导致同名地点定位到错误国家。'),
    },
    async ({ query, limit, country, provider }) => {
      const googleProvider = mapProviderFactory.createServiceProvider('search', provider)

      const searchResults = await googleProvider.searchPlaces(query, undefined, country)
      const results = searchResults.slice(0, limit).map(r => ({
        name: r.name,
        coordinates: r.coordinates,
        address: r.address || '',
        placeReferences: r.placeReferences,
            placeId: r.placeId || '',
        rating: r.rating || null,
        types: r.types || [],
      }))

      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      }
    }
  )

  // get_place_details
  server.tool(
    'get_place_details',
    '根据坐标获取地点的详细信息，包括电话、网站、评分、营业时间、地点类型等。',
    {
      provider: z.enum(['google', 'amap']).optional().describe('地点详情后端，不填使用服务端配置'),
      latitude: z.number().describe('纬度'),
      longitude: z.number().describe('经度'),
    },
    async ({ latitude, longitude, provider }) => {
      const details = await mapProviderFactory.createServiceProvider('details', provider).getPlaceDetails({ latitude, longitude })
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] }
    }
  )

  const coordinates = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  const directionInputs = {
    provider: z.enum(['google', 'amap']).optional().describe('路线后端，不填使用服务端配置'),
    origin: coordinates.describe('WGS-84 起点坐标'),
    destination: coordinates.describe('WGS-84 终点坐标'),
  }
  server.tool(
    'get_directions',
    '计算两点间的行程关联路线、距离和耗时。transportMode 按已安排的交通方式映射，优先于 mode；均省略时，小于2km步行，否则驾车。飞机/轮船/其他及无可用路线返回示意连接、标明直线距离，耗时为null；不是逐路口导航。',
    {
      ...directionInputs,
      mode: z.enum(['walking', 'driving', 'bicycling', 'transit']).optional().describe('显式寻路模式；未设置交通安排时可用，省略自动按距离选择'),
      transportMode: transportModeSchema.optional().describe('行程链路交通方式，不支持的方式返回虚线示意，不伪造道路路线'),
    },
    async ({ origin, destination, mode, provider, transportMode }) => {
      const result = await getSavedDirection(origin, destination, mode, provider, transportMode)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )
  // Compatibility for existing external clients; the Web AI exposes get_directions only.
  server.tool('get_walking_directions', '兼容旧客户端：固定步行。新调用请用 get_directions。', directionInputs,
    async ({ origin, destination, provider }) => {
      const result = await getSavedDirection(origin, destination, 'walking', provider)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )
}
