import { z } from 'zod'
import type { PlaceReferences, PlaceReferencesPatch, PlaceReferenceProvider } from '@/types/place-references'

// Reject controls before trim, so a trailing newline cannot be hidden by normalization.
const placeIdSchema = z.string().max(2048).refine(id => !/[\u0000-\u001f\u007f-\u009f]/.test(id), 'placeId must not contain control characters')
    .transform(id => id.trim()).pipe(z.string().min(1, 'placeId must not be empty'))
const referenceSchema = z.object({ placeId: placeIdSchema }).strict()
export const placeReferencesPatchSchema = z.object({
    apple: referenceSchema.nullable().optional(),
    google: referenceSchema.nullable().optional(),
    amap: referenceSchema.nullable().optional(),
}).strict().nullable()

export class PlaceReferencesValidationError extends Error {}
export function parsePlaceReferences(value: unknown): PlaceReferencesPatch {
    const result = placeReferencesPatchSchema.safeParse(value)
    if (!result.success) throw new PlaceReferencesValidationError(`Invalid placeReferences: ${result.error.issues.map(issue => `${issue.path.join('.') || 'placeReferences'}: ${issue.message}`).join('; ')}`)
    return result.data
}
export function mergePlaceReferences(existing: PlaceReferences | null, patch: PlaceReferencesPatch | undefined): PlaceReferences | null {
    if (patch === undefined) return existing
    if (patch === null) return null
    const result: PlaceReferences = { ...existing }
    for (const provider of ['apple', 'google', 'amap'] as const) {
        if (patch[provider] === null) delete result[provider]
        else if (patch[provider] !== undefined) result[provider] = patch[provider]
    }
    return Object.keys(result).length ? result : null
}
/** Only call at a provider boundary with an official ID, never a UI dedup ID. */
export function officialPlaceReferences(provider: PlaceReferenceProvider, placeId: unknown): PlaceReferences | undefined {
    const result = placeReferencesPatchSchema.safeParse({ [provider]: { placeId } })
    return result.success ? mergePlaceReferences(null, result.data) ?? undefined : undefined
}
