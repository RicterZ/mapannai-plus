# 地点的平台 POI 引用合约

`Marker.placeReferences` 保存同一物理地点在 Apple、Google、高德上的身份，与底图、搜索 provider、WGS-84 坐标独立。服务端只校验结构并保存声明，不调用 Apple SDK，不验证 ID 的真实性，也不因保存引用额外请求第三方服务。不同收藏允许指向同一个官方 POI，没有全局唯一约束。

公共类型：`src/types/place-references.ts`；公共校验与合并：`src/lib/places/place-references.ts`。普通 Marker JSON 的字段位于顶层，不在 `content` 中；Dataset GeoJSON 位于 `feature.properties.placeReferences`。旧客户端仍可省略该字段，客户端读取旧服务响应时应将缺失字段视为无引用。

## 创建

`POST /api/markers` 请求示例：

```json
{
  "coordinates": { "latitude": 35.71, "longitude": 139.79 },
  "title": "东京 浅草寺",
  "iconType": "culture",
  "address": "东京台东区",
  "content": "<p>清晨游览</p>",
  "placeReferences": {
    "apple": { "placeId": "Apple-Opaque_ID" },
    "google": { "placeId": "Google-Opaque_ID" }
  }
}
```

创建时省略、`null`、`{}` 或全部 provider 为 `null`，均保存为无引用；对象保存合法的非 null 引用。

现有创建接口仍使用六位小数坐标 hash ID 和 10m 去重。若返回已有收藏，返回其原有引用，不根据距离/名称把本次搜索结果或声明附到已有收藏，也不覆盖已有内容。需要明确修改既有收藏引用时，调用编辑接口。Dataset 通过不同 `featureId` 可保存不同收藏，即使引用同一个官方 POI；本功能不新增唯一约束，也不改变原有创建去重行为。

`POST /api/markers/v2` 继续接受 `name/iconType/content/country/provider`，使用选中的首个官方搜索结果的引用。显式传入 `placeReferences` 时，以调用方声明为准（包括 null）；非法声明在搜索前返回 400。该接口不验证声明真实性。未找到平台 ID 时不从名称、坐标、内部 id 推断。

## 编辑

`PUT /api/markers/{id}` 是字段 patch；现有字段名不变，并支持 `address`、`coordinates` 和 `placeReferences`。例如原有 apple、google 引用：

```json
{
  "title": "浅草寺",
  "markdownContent": "<p>先去正殿</p>",
  "placeReferences": {
    "amap": { "placeId": "AMap-Opaque_ID" },
    "google": null
  }
}
```

结果保留 apple、新增 amap、删除 google。合并与写入在同一 SQLite IMMEDIATE 事务内完成；每次读取最新引用，跨连接并发更新不同 provider 不会互相覆盖。

| 写入方式 | 编辑语义 |
| --- | --- |
| 省略 `placeReferences` | 保留全部已有引用 |
| `placeReferences: null` | 清空全部引用 |
| `placeReferences: {}` | 不修改引用 |
| `{"google": null}` | 只删除 Google 引用 |
| `{"google": {"placeId": "new-id"}}` | 新增或替换 Google，保留其他平台 |

### 坐标变化

- 坐标始终为 WGS-84；平台引用不会转换或覆盖坐标。
- 沿用坐标 hash 的精度约定：经纬度分别 `Math.round(value * 1_000_000)`，任一轴不同即视为确实移动。存储坐标不因此截断。
- 移动时先清除全部旧引用，再应用本次显式 `placeReferences`；只有本次显式给出的非 null 平台会留下。
- 移动并省略、传 null、传 `{}`，均得到无引用。未改变六位小数坐标时沿用上面的普通合并语义。
- 修改名称、地址、图标、笔记或封面不会清除引用。
- 客户端移动地点时，不应把本地旧引用随整个 Marker 原样回传，否则会被视为调用方显式提供的新引用。

移动并设置新身份示例：

```json
{
  "coordinates": { "latitude": 35.72, "longitude": 139.8 },
  "placeReferences": { "google": { "placeId": "New-Google-ID" } }
}
```

### 校验与错误

顶层只允许对象或 null。仅支持 `apple/google/amap`；未知 provider、对象多余字段（包括 Key、token、SDK 属性）、数组、错误类型、空 ID、控制字符均返回 400，沿用 `{ "error": "Invalid placeReferences: ..." }` 格式，不回显 ID。引用错误和其他字段一起原子失败。

每个平台值仅允许 null 或严格的 `{ "placeId": string }`。ID 不转数字，不改变大小写，不使用某个平台的格式正则。原始字符串最多 **2048 个 JavaScript UTF-16 code units**，拒绝 U+0000–U+001F、U+007F–U+009F，之后执行 `String.trim()` 去除首尾空白；trim 后必须非空。除此之外不改写 ID。provider 返回的 ID 也使用同一规则，非法/缺失官方 ID 时省略引用而不影响旧搜索字段。

现有全站 `/api/*` token 鉴权与请求处理限制不变，未额外放宽请求大小。本项目为共享数据集，没有账号、地点 owner 或按用户隔离权限；合法全站 token 拥有现有数据集操作权，不能声称已经实现用户级隔离。缺失或错误 token 仍返回 401。

## 读取

以下是创建、编辑或 `GET /api/markers/{id}` 的完整 Marker 结构示例（时间/ID由服务器产生）：

```json
{
  "id": "coord_example",
  "coordinates": { "longitude": 139.79, "latitude": 35.71 },
  "placeReferences": {
    "apple": { "placeId": "Apple-Opaque_ID" },
    "amap": { "placeId": "AMap-Opaque_ID" }
  },
  "content": {
    "id": "coord_example",
    "title": "浅草寺",
    "address": "东京台东区",
    "iconType": "culture",
    "markdownContent": "<p>先去正殿</p>",
    "next": [],
    "createdAt": "2026-10-04T00:00:00.000Z",
    "updatedAt": "2026-10-04T00:01:00.000Z"
  }
}
```

无引用统一返回 `"placeReferences": null`，不返回值为 null 的 provider。可选的 address/headerImage 等字段仍按现有规则省略。`GET /api/markers` 数组采用同一结构。

旅行与日期接口目前只存/返回 marker ID，不内嵌 Marker。通过 ID 读取地点获得引用；加入/移出旅行、日期、链路与排序不修改引用。删除 Marker 时引用随行删除。

## 搜索和详情

`GET /api/search` 的既有 id、placeId、分页和 provider 选择规则保持不变。单个结果可增加：

```json
{
  "id": "东京 浅草寺",
  "name": "东京 浅草寺",
  "coordinates": { "latitude": 35.71, "longitude": 139.79 },
  "address": "东京台东区",
  "placeId": "Google-Official-ID",
  "placeReferences": { "google": { "placeId": "Google-Official-ID" } },
  "rating": 0,
  "types": [],
  "properties": {}
}
```

搜索/详情无官方引用时**省略** `placeReferences`；保存后的 Marker 无引用才统一返回 null。正式来源：

- Google 搜索：响应 `results[].place_id`；详情：逆地理编码选中结果的 `place_id`，该 ID 也用于既有详情请求。
- 高德搜索：`pois[].id`；详情：既有详情响应 POI 的 `id`（详情失败则采用既有逆地理编码 POI 的 `id`）。
- Apple：由 iOS 原生 SDK 获取，服务端无 Apple 查询。

不把搜索结果用于 UI 去重的 `id`、名称、随机 UUID 或拼接字符串当作官方 ID。`POST /api/places` 和 MCP `get_place_details` 可返回相同可选引用；坐标反查的身份是返回的附近 POI，**不是原点击位置**。详情请求不自动写入收藏。

## Web 与 AI

Web 搜索结果 → 草稿 → 新建弹窗 → POST → 返回 Marker 全程透传引用。现有底图点击回调只提供坐标、没有已确认的官方平台身份，因此省略引用；不使用附近反查替代它。OSM 与高德共用此规则，不从瓦片 feature/internal id 推断。未新增 Apple SDK 查询或 ID 输入框，未改导航行为。

Web 加载 Dataset 将 `properties.placeReferences` 放回顶层 Marker；普通笔记/图标/封面保存不回传旧引用，引用由服务端保留；移动坐标由服务端清理，再将返回引用同步回本地。

- `create_marker`、`plan_trip_day`：服务器执行官方搜索后，透传实际选中结果引用。继续原有 existing/created/error、成功 id 和批量行为；去重命中时仅返回已有引用。
- `update_marker`：支持可选 `placeReferences` patch，使用公共严格校验和事务合并；属于**调用方声明**，不是服务器验证过的官方身份。改笔记未传该字段则保留。
- `list_markers`、创建/规划/更新工具结果返回保存引用。`search_places/get_place_details` 返回 provider 可选引用。
- 提示词明确不编造、不按名称/坐标推断 POI ID。创建/规划工具不接受模型指定的 ID 替代实际搜索结果。
- Web AI 仍通过同一 MCP 工具；不改 NDJSON 事件封套、created-ID hook 或自动重试写入。

## 数据迁移、导入与备份

`src/lib/db/index.ts` 在启动时检查 `PRAGMA table_info(markers)`，不存在则执行 `ALTER TABLE markers ADD COLUMN place_references TEXT`。可空 JSON TEXT，旧行 NULL，无回填、无外部请求、不改其他字段和已有数据，无唯一索引。幂等兼容原有库。

`GET /api/dataset` 的 GeoJSON `properties.placeReferences` 保留引用；`POST /api/dataset` 接受同位置 patch，和 Marker API 使用同一校验/合并/坐标清理规则。明确复制同一物理地点的 GeoJSON 到新 featureId 可保留引用。当前没有单独的文件导入导出或地点复制 UI；Dataset 是现有数据交换入口，SQLite 整库备份天然包含新增列。现有行程链迁移脚本不操作 Marker 引用。

## iOS 接入

1. 在 Marker 解码模型增加可选顶层 `placeReferences`；兼容缺失/null、同一地点多平台引用，不强制与当前底图一致。
2. 点击原生官方 POI 后，只提取 SDK 正式地点标识，按对应平台写入新建请求；手动坐标无标识则省略。不上传 SDK 对象或凭据。
3. 搜索选中结果携带 `placeReferences`；对已有明确身份的草稿，附近反查不得替换原平台身份。
4. 编辑普通字段省略引用；明确增改引用按平台 patch，删单个平台传 provider null，全部清空传顶层 null。移动地点省略旧引用，只在确有新身份时显式传入。
5. 创建响应可能按现有去重规则返回已有地点：以返回 id/引用为准，不自行将搜索引用并入去重收藏。
6. 导航/详情按目标平台读取对应引用；没有引用、旧响应缺失或原生解析失败时保留现有坐标兜底。Apple 原生恢复和各平台客户端打开详情行为由 iOS 实现，本轮服务端不实现或验证它们。

## 验证

运行 `npx tsx scripts/test-place-references.ts`。测试在系统临时目录创建旧 SQLite 库，启动仅绑定 loopback 随机端口的独立 HTTP 测试后端，通过实际 route handlers 和鉴权 middleware 验证。第三方 HTTP 均 mock，意外外网请求直接失败；不读取 .env、不使用生产数据库、不发生第三方费用。

覆盖旧库、创建单/多平台、null/省略/合并、严格结构与原子失败、普通字段保留、坐标精度/移动清理、Dataset交换/复制、Web store、官方搜索→创建→读取、内部id不推断、附近详情不写入、旅行/日期/链路不改引用、实际 MCP/AI、无鉴权拒绝、HTTP并发和三个独立进程/SQLite连接并发合并、删除。Web UI 与 SDK 使用 mock/类型构建验证，没有实际 Apple/Google/高德 SDK 详情恢复测试。
