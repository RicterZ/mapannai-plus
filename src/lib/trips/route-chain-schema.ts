import { z } from 'zod'

const id = z.string().min(1).max(200)
const text = (max: number) => z.string().trim().max(max).nullable().transform(value => value || null)
export const schedulePatchFields = {
    startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '时间须为 HH:mm').nullable().optional().describe('行程日当地时间 HH:mm；null 清除，不自动推算其他时间'),
    durationMinutes: z.number().int().nonnegative().nullable().optional().describe('用户计划时长，单位分钟；null 清除，不是寻路 API 耗时'),
    note: text(4000).optional().describe('补充备注，例如入口、站台或预约事项；null 或空字符串清除'),
}
export const stopPatchSchema = z.object({
    stopId: id.describe('routeChains.stops 中的访问 ID，不是 marker ID'),
    ...schedulePatchFields,
}).strict()
export const transportModeSchema = z.enum(['walking', 'cycling', 'driving', 'taxi', 'bus', 'subway', 'train', 'flight', 'ferry', 'other'])
export const legPatchSchema = z.object({
    fromStopId: id.describe('相邻路段的起点访问 ID'),
    toStopId: id.describe('相邻路段的终点访问 ID；必须按路线方向相邻'),
    mode: transportModeSchema.optional().describe('交通方式；新建交通安排时必填'),
    serviceNumber: text(120).optional().describe('独立线路/车次号字段，如地铁2号线、公交101、G123、NH920、船班号；不要塞进 note'),
    ...schedulePatchFields,
    remove: z.boolean().optional().describe('true 清除整段交通安排，不删除地点；不能同时填写其他安排字段'),
}).strict()
export const routeChainPatchSchema = z.object({
    markerIds: z.array(id).min(2).optional().describe('可选的新完整地点顺序；同一路线不得重复 marker ID'),
    stops: z.array(stopPatchSchema).optional(),
    legs: z.array(legPatchSchema).optional(),
}).strict()
export type RouteChainPatch = z.input<typeof routeChainPatchSchema>
