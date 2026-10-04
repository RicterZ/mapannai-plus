/** Opaque, caller-declared platform identities. Coordinates remain WGS-84. */
export type PlaceReferenceProvider = 'apple' | 'google' | 'amap'
export interface PlaceReference { placeId: string }
export type PlaceReferences = Partial<Record<PlaceReferenceProvider, PlaceReference>>
export type PlaceReferencesPatch = Partial<Record<PlaceReferenceProvider, PlaceReference | null>> | null
