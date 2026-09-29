/**
 * MCP Search & Directions Tools
 * Place search, place details, and walking directions exposed as MCP tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
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

  // get_walking_directions
  server.tool(
    'get_walking_directions',
    '获取两点之间的步行路线，返回路径点、距离（米）和预计时间（秒）。',
    {
      provider: z.enum(['google', 'amap']).optional().describe('路线后端，不填使用服务端配置'),
      origin: z.object({
        lat: z.number().describe('起点纬度'),
        lng: z.number().describe('起点经度'),
      }).describe('起点坐标'),
      destination: z.object({
        lat: z.number().describe('终点纬度'),
        lng: z.number().describe('终点经度'),
      }).describe('终点坐标'),
    },
    async ({ origin, destination, provider }) => {
      const result = await mapProviderFactory.createServiceProvider('directions', provider).getDirections(origin, destination, 'walking')
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )
}
