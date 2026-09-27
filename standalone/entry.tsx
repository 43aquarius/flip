/**
 * 《翻》FLIP — 单文件版（standalone）挂载入口
 *
 * 仅由 esbuild 打包为 IIFE 内联进根目录 index.html；
 * 不参与 Next.js 应用编译（src/app/page.tsx 仍是线上入口）。
 */
import { createRoot } from 'react-dom/client'
import BookStage from '@/components/book/BookStage'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<BookStage />)
}
