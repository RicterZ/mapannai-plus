/**
 * 客户端直传 COS 工具函数
 */
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import { compressedImageUrl } from './image-url'

export interface S3UploadResult {
    success: boolean
    url?: string
    error?: string
}

/**
 * 直接上传文件到 COS（客户端）
 */
export async function uploadFileToS3(file: File): Promise<S3UploadResult> {
    try {
        // 1. 获取预签名 URL
        const presignedResponse = await fetchWithAuth(`/api/upload?t=${Date.now()}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fileName: file.name,
                fileType: file.type,
            }),
        })

        if (!presignedResponse.ok) {
            throw new Error('Failed to get presigned URL')
        }

        const presignedData = await presignedResponse.json()

        if (!presignedData.success) {
            throw new Error(presignedData.message || 'Failed to get presigned URL')
        }

        // 2. 直接上传到 COS
        const uploadResponse = await fetch(presignedData.presignedUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': file.type,
            },
            body: file,
        })

        if (!uploadResponse.ok) {
            throw new Error(`Upload failed with status: ${uploadResponse.status}`)
        }

        // 3. 返回成功结果
        return {
            success: true,
            url: compressedImageUrl(presignedData.publicUrl),
        }
    } catch (error) {
        console.error('COS direct upload error:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Upload failed',
        }
    }
}

/**
 * 通过 URL 上传图片到 COS
 */
export async function uploadImageByUrlToS3(imageUrl: string): Promise<S3UploadResult> {
    try {
        // 1. 获取图片数据
        const imageResponse = await fetch(imageUrl)

        if (!imageResponse.ok) {
            throw new Error('Failed to fetch image from URL')
        }

        const imageBlob = await imageResponse.blob()

        // 2. 创建 File 对象
        const fileName = imageUrl.split('/').pop() || 'image.jpg'
        const file = new File([imageBlob], fileName, { type: imageBlob.type })

        // 3. 使用直传函数上传
        return await uploadFileToS3(file)
    } catch (error) {
        console.error('COS URL upload error:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'URL upload failed',
        }
    }
}
