// Configuration file for the application
export const config = {
    // 地图提供者配置
    map: {
        amap: {
            accessToken: process.env.AMAP_API_KEY || '',
            baseUrl: process.env.AMAP_API_BASE_URL || 'https://restapi.amap.com',
        },
        google: {
            accessToken: process.env.GOOGLE_API_KEY || '',
            // Google API 基础 URL - 使用反向代理
            baseUrl: process.env.GOOGLE_API_BASE_URL || 'https://maps.googleapis.com',
        },
    },
    // 腾讯云COS配置
    tencent: {
        cos: {
            secretId: process.env.TENCENT_COS_SECRET_ID || '',
            secretKey: process.env.TENCENT_COS_SECRET_KEY || '',
            region: process.env.TENCENT_COS_REGION || 'ap-chongqing',
            bucket: process.env.TENCENT_COS_BUCKET || '',
        },
    },
    app: {
        defaultCenter: {
            latitude: 35.6895,
            longitude: 139.6917,
        },
        defaultZoom: 11,
        // 缩放级别阈值：小于此值时隐藏连接线和显示简化标记
        zoomThreshold: 9,
    },
    // 城市快速跳转配置
    cities: {
        kyoto: {
            name: '京都',
            coordinates: { longitude: 135.7681, latitude: 35.0116 },
            zoom: 12
        },
        osaka: {
            name: '大阪',
            coordinates: { longitude: 135.5022, latitude: 34.6937 },
            zoom: 12
        },
        yokohama: {
            name: '横滨',
            coordinates: { longitude: 139.6380, latitude: 35.452 },
            zoom: 12
        },
        tokyo: {
            name: '东京',
            coordinates: { longitude: 139.6917, latitude: 35.6895 },
            zoom: 10
        },
    },
} as const

export type Config = typeof config 
