import { parsePlaceReferences, PlaceReferencesValidationError } from '@/lib/places/place-references'
import type { MapSearchResult } from '@/types/map-provider'
import { NextRequest, NextResponse } from 'next/server';
import { MarkerIconType } from '@/types/marker';
import {
    upsertMarker,
    findNearbyMarker,
    generateCoordinateHash,
    featureToMarker,
} from '@/lib/db/marker-service';
import { mapProviderFactory } from '@/lib/map/providers';

// 搜索地点获取坐标（直接调用服务层，不经过 HTTP）
async function searchPlace(name: string, country: string, provider?: string): Promise<MapSearchResult> {
  const googleProvider = mapProviderFactory.createServiceProvider('search', provider);
  const results = await googleProvider.searchPlaces(name, undefined, country);

  if (!results || results.length === 0) {
    throw new Error('未找到该地点');
  }

  return results[0];
}

// 创建新标记 (v2 - 通过地点名称)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, iconType, content, country = 'JP', provider } = body;

    if (!name || !iconType) {
      return NextResponse.json(
        { error: '缺少必需参数: name, iconType' },
        { status: 400 }
      );
    }

    const declared = body.placeReferences === undefined ? undefined : parsePlaceReferences(body.placeReferences);
    const result = await searchPlace(name, country, provider);
    const coordinates = result.coordinates;

    // 检查是否存在相近的标记（哈希 + 10米范围内）
    const existing = findNearbyMarker(coordinates.longitude, coordinates.latitude, 10);

    if (existing) {
      return NextResponse.json(featureToMarker(existing));
    }

    // 创建新标记
    const coordinateHash = generateCoordinateHash(coordinates.longitude, coordinates.latitude);
    const featureId = `coord_${coordinateHash}`;
    const now = new Date();

    const properties = {
      placeReferences: declared === undefined ? result.placeReferences : declared,
      markdownContent: content || '',
      headerImage: null,
      iconType: iconType as MarkerIconType,
      next: [],
      metadata: {
        id: featureId,
        title: name,
        description: '用户创建的标记',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        isPublished: true,
        coordinateHash,
      },
    };

    const feature = upsertMarker(featureId, coordinates.longitude, coordinates.latitude, properties);
    return NextResponse.json(featureToMarker(feature));
  } catch (error) {
    if (error instanceof PlaceReferencesValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(
      { error: '创建标记失败' },
      { status: 500 }
    );
  }
}
