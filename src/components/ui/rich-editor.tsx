'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { uploadFileToS3 } from '@/lib/upload/direct-upload'
import { toast } from 'sonner'
import { cn } from '@/utils/cn'
import { useRef, useState, useEffect, useCallback } from 'react'

interface RichEditorProps {
    content: string
    onChange: (html: string) => void
    placeholder?: string
    editable?: boolean
    onUploadingChange?: (uploading: boolean) => void
}

// ── Toolbar button ─────────────────────────────────────────────────────────

function ToolBtn({
    onClick,
    active,
    disabled,
    title,
    children,
}: {
    onClick: () => void
    active?: boolean
    disabled?: boolean
    title?: string
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onClick() }}
            disabled={disabled}
            title={title}
            className={cn(
                'flex items-center justify-center w-9 h-9 rounded-lg text-sm font-medium transition-colors select-none flex-shrink-0',
                active
                    ? 'bg-accent-100 text-accent-700'
                    : 'text-gray-600 hover:bg-gray-100 active:bg-gray-200',
                disabled && 'opacity-30 pointer-events-none',
            )}
        >
            {children}
        </button>
    )
}

// ── Divider ────────────────────────────────────────────────────────────────

function Divider() {
    return <div className="w-px h-6 bg-gray-200 mx-0.5 flex-shrink-0" />
}

// ── Main editor ────────────────────────────────────────────────────────────

export function RichEditor({ content, onChange, placeholder = '记录地点笔记…', editable = true, onUploadingChange }: RichEditorProps) {
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            Image.configure({ inline: false, allowBase64: false }),
            Placeholder.configure({ placeholder }),
            Underline,
        ],
        content: content || '',
        onUpdate: ({ editor }) => onChange(editor.getHTML()),
        editorProps: {
            attributes: {
                class: 'rich-editor-content focus:outline-none min-h-[120px] px-4 py-3',
            },
        },
    })

    useEffect(() => { editor?.setEditable(editable) }, [editor, editable])
    useEffect(() => { onUploadingChange?.(isUploading) }, [isUploading, onUploadingChange])

    // editor 初始化完成后设置初始内容，之后完全由用户编辑，不再响应外部 content prop 变化
    const initializedRef = useRef(false)
    useEffect(() => {
        if (!editor || initializedRef.current) return
        initializedRef.current = true
        if (content) {
            editor.commands.setContent(content, { emitUpdate: false })
        }
    }, [editor])

    const handleImageUpload = useCallback(async (file: File) => {
        if (!editor) return
        setIsUploading(true)
        try {
            const result = await uploadFileToS3(file)
            if (result.success && result.url) {
                editor.chain().focus().setImage({ src: result.url, alt: file.name }).run()
            } else {
                toast.error('图片上传失败')
            }
        } catch {
            toast.error('图片上传失败')
        } finally {
            setIsUploading(false)
        }
    }, [editor])

    const triggerImagePicker = useCallback(() => {
        fileInputRef.current?.click()
    }, [])

    if (!editor) return null

    const canUndo = editor.can().undo()
    const canRedo = editor.can().redo()

    return (
        <fieldset disabled={!editable} className="flex min-w-0 flex-col h-full">
            {/* ── Editor area ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                <EditorContent editor={editor} />
            </div>

            {/* ── Bottom toolbar ────────────────────────────────────────── */}
            <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50">
                {isUploading && (
                    <div className="px-4 py-1.5 flex items-center gap-2 text-xs text-accent-600 border-b border-gray-200">
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        上传图片中...
                    </div>
                )}
                <div className="flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto">
                    {/* Headings */}
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        active={editor.isActive('heading', { level: 1 })}
                        title="标题 1"
                    >
                        <span className="text-xs font-bold">H1</span>
                    </ToolBtn>
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        active={editor.isActive('heading', { level: 2 })}
                        title="标题 2"
                    >
                        <span className="text-xs font-bold">H2</span>
                    </ToolBtn>
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                        active={editor.isActive('heading', { level: 3 })}
                        title="标题 3"
                    >
                        <span className="text-xs font-bold">H3</span>
                    </ToolBtn>

                    <Divider />

                    {/* Inline formats */}
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        active={editor.isActive('bold')}
                        title="加粗"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
                        </svg>
                    </ToolBtn>
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        active={editor.isActive('italic')}
                        title="斜体"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" />
                        </svg>
                    </ToolBtn>
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleUnderline().run()}
                        active={editor.isActive('underline')}
                        title="下划线"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" /><line x1="4" y1="21" x2="20" y2="21" />
                        </svg>
                    </ToolBtn>

                    <Divider />

                    {/* Lists */}
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        active={editor.isActive('bulletList')}
                        title="无序列表"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
                            <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
                        </svg>
                    </ToolBtn>
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        active={editor.isActive('orderedList')}
                        title="有序列表"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" />
                            <text x="2" y="8" fontSize="7" fill="currentColor" stroke="none" fontWeight="600">1</text>
                            <text x="2" y="14" fontSize="7" fill="currentColor" stroke="none" fontWeight="600">2</text>
                            <text x="2" y="20" fontSize="7" fill="currentColor" stroke="none" fontWeight="600">3</text>
                        </svg>
                    </ToolBtn>
                    <ToolBtn
                        onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        active={editor.isActive('blockquote')}
                        title="引用"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
                            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
                        </svg>
                    </ToolBtn>

                    <Divider />

                    {/* Image */}
                    <ToolBtn
                        onClick={triggerImagePicker}
                        disabled={isUploading}
                        title="插入图片"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                        </svg>
                    </ToolBtn>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Undo / Redo */}
                    <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!canUndo} title="撤销">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                        </svg>
                    </ToolBtn>
                    <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!canRedo} title="重做">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
                        </svg>
                    </ToolBtn>
                </div>
            </div>

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImageUpload(file)
                    e.target.value = ''
                }}
            />
        </fieldset>
    )
}
