import { z } from 'zod'

export const tripMarkerNotePatchSchema = z.object({
    headerImage: z.union([z.literal(''), z.url().max(4096).refine(value => /^https?:\/\//i.test(value))]).nullable().optional(),
    title: z.string().trim().max(200).nullable().optional(),
    content: z.string().max(500_000).nullable().optional(),
    expectedUpdatedAt: z.string().nullable().optional(),
}).strict()
export type TripMarkerNotePatch = z.infer<typeof tripMarkerNotePatchSchema>
