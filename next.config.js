/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
    dest: 'public',
    disable: process.env.NODE_ENV === 'development',
    register: true,
    skipWaiting: true,
    runtimeCaching: [
        // OSM 地图瓦片：NetworkFirst，只缓存成功响应，失败直接穿透
        {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.+/,
            handler: 'NetworkFirst',
            options: {
                cacheName: 'osm-tiles',
                expiration: {
                    maxEntries: 256,
                    maxAgeSeconds: 7 * 24 * 60 * 60, // 7 天
                },
                cacheableResponse: {
                    statuses: [200], // 只缓存 200，绝不缓存失败响应
                },
            },
        },
    ],
})

const nextConfig = {
    experimental: { instrumentationHook: true, serverComponentsExternalPackages: ['ws'] },
    // 启用 standalone 输出模式，用于 Docker 优化
    output: 'standalone',
    images: {
        // 从环境变量获取图片域名
        domains: process.env.NEXT_PUBLIC_IMAGE_DOMAINS?.split(',') || [
            'mapannai-1253047877.cos.ap-chongqing.myqcloud.com'
        ],
    },
    webpack: (config) => {
        config.resolve.fallback = {
            ...config.resolve.fallback,
            fs: false,
        };
        return config;
    },
}

module.exports = withPWA(nextConfig)
