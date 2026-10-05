# 按交通安排计算行程路线

Web 路线规划只保留开关，不再提供全局自动/步行/驾车选择。每段路线读取 `routeChains` 当前相邻 stops 间有方向的 active leg；没有 leg 时小于2km步行，否则驾车。只改变路线计算方式，已有曲线、剪枝、平滑、重合分离、描边、点击层和动画共用显示路径的规则保留。

## 交通映射

| 行程 `ChainLeg.mode` | 寻路 `mode` |
| --- | --- |
| walking | walking |
| cycling | bicycling |
| driving、taxi | driving |
| bus、subway、train | transit |
| flight、ferry、other | 不调用寻路，虚线贝塞尔曲线 |
| 未设置交通安排 | 两点WGS-84直线距离 <2km walking，≥2km driving |

共享映射在 `src/lib/map/route-mode.ts`。按 stop ID 和方向读取 active leg，不使用 inactiveLegs，不继承反向安排。编辑方式、清除安排、调整顺序、坐标变更后，两种地图和侧栏同步读取同一映射。车次号、备注、开始时间和用户计划时长仍为手动安排；本轮不做班次匹配、时刻表规划或根据寻路耗时改写用户时长。

开启路线规划后，未取得有效规划路程（含尚在计算、请求失败、无路程缓存和虚线回退）时，距离来自坐标 Haversine 计算；成功后自动换成平台路程，不取贝塞尔显示线长度。界面只展示 `500 m`、`2.5 km` 等数值，不添加“直线”文字；API 与前端共用 `routeDistance`，统一返回/显示 distance，不增加距离类型字段；回退耗时为 null。

## API

现有 `POST /api/directions`，不新增接口：

```json
{
  "origin": { "lat": 39.9, "lng": 116.4 },
  "destination": { "lat": 39.901, "lng": 116.401 },
  "transportMode": "subway"
}
```

- `origin/destination` 为有限、有效范围内的 WGS-84 坐标。
- 可选 `transportMode` 接受上表内置十种方式，优先于 `mode`。
- 可选 `mode` 为 walking/driving/bicycling/transit，保留已有显式调用兼容。
- 均省略时按2km阈值。旧省略 mode 的请求不再固定步行。
- 显式 null 或未知值返回400，沿用 `{ "error": "..." }`。
- API 使用服务端配置的 directions provider，不增加前端切换。

成功返回既有 `path/distance/duration` 结构。不能映射的方式无需请求 provider，返回如下结构（数值仅示例）：

```json
{
  "path": [{ "lat": 39.9, "lng": 116.4 }, { "lat": 39.901, "lng": 116.401 }],
  "distance": 140.15,
  "duration": null,
  "fallback": "UNSUPPORTED_MODE"
}
```

客户端看到 fallback 时用已有虚线贝塞尔显示，不把 path 中两点视为道路几何。普通寻路仍返回平台路程/耗时。已有 OVER_DIRECTION_RANGE、UNSUPPORTED_REGION 回退，以及新增 NO_ROUTE，均返回坐标距离和 null 耗时；旧缓存中的 null 距离读取时补算，不改原路线数据。缺少有效规划距离或路径也返回 NO_ROUTE。QPS、网络及凭据错误返回 HTTP 500，并附带 fallback: PLANNING_FAILED、两点 path、坐标 distance、null duration 和原有 error；不写入缓存，Web 保留重试，MCP 返回相同结果并标记 isError。所有按坐标补算的服务端结果均带 fallback，成功取得有效规划路程时省略 fallback。

## Provider 与缓存

- 高德步行/驾车保留 v3 接口；自行车调用 v4 bicycling，兼容其 errcode/data 返回结构。
- 高德公共交通调用 v3 transit/integrated；city/cityd 必填，因此仅在路线缓存未命中时逆地理编码两个端点取得城市代码，再查询路线。读取步行、公交与铁路分段的形状，铁路站点坐标支持高德返回的空格分隔格式；只有站点坐标时使用官方站点序列连接，这不是实际铁路轨迹，不提供逐路口导航。
- Google 保留 Directions Legacy，四种模式透传；ZERO_RESULTS 转为 NO_ROUTE。公交/地铁/火车都使用公共交通规划，没有承诺只乘指定交通类型或指定车次。
- 两个平台均共享 SQLite 原始路线缓存；客户端共享请求队列、内存和 localStorage。缓存使用实际 mode、有向起终点与坐标，行程交通修改不会读取旧方式路线。既有步行、驾车缓存继续复用。
- 公共交通结果和 NO_ROUTE 缓存1小时，避免长期复用随时刻变化的方案；超范围/不支持地区终止结果仍持久保留。无法映射的行程无需第三方或额外 SQLite 记录，客户端只生成示意曲线。
- 这不是基于旅行日期的班次查询；当前公共交通接口使用平台默认时刻。

## MCP 与 AI

`get_directions` 提供 origin/destination、可选 mode、transportMode、provider，和 API 使用同一映射与缓存服务。AI 应根据最新 routeChains 的交通安排传 transportMode，无安排则省略。

旧 `get_walking_directions` 保留并固定 walking，兼容外部 MCP 客户端；Web AI 工具列表仅暴露 get_directions，两个入口均属于只读工具。NDJSON封套、已有创建工具ID hook与写入行为不变。

## 验证

`npx tsx scripts/test-itinerary-routing.ts` 使用临时 SQLite、实际 API handler、MCP bridge 和 provider HTTP mocks，验证十种交通映射、2km边界、方向与移回恢复、四种Google模式、高德四种请求/返回解析、公共交通城市查询与缓存、虚线距离/耗时、临时/终止失败、旧缓存复用、MCP兼容、客户端缓存与卡片渲染。两种 renderer 按同一映射接入，通过源码/类型与构建检查；没有真实SDK或付费第三方寻路验证。现有路径算法源文件未修改。
