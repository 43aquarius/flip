'use client'

import { ART_COMPONENTS, ART_COUNT, type BookPage } from '@/lib/book/pages'
import { PageBadge } from './PageBadge'
import {
  CoverPage,
  InsideCoverPage,
  TocPage,
  ColophonPage,
  InsideBackPage,
  BackCoverPage,
  PaperBack,
} from './structural-pages'

interface PageSurfaceProps {
  page: BookPage
  /** 该表面在书上的位置：桌面跨页的左/右页，或移动端单页 */
  side: 'left' | 'right' | 'single'
  /** 是否处于可动画状态（当前可见页及其相邻页） */
  active: boolean
  onOpenCover?: () => void
  onBackCover?: () => void
  onJumpToArt?: (artIndex: number) => void
  onJumpToFlat?: (flat: number) => void
}

/** 把注册表里的一个页面渲染成一个具体表面 */
export function PageSurface({
  page,
  side,
  active,
  onOpenCover,
  onBackCover,
  onJumpToArt,
  onJumpToFlat,
}: PageSurfaceProps) {
  let content: React.ReactNode = null

  switch (page.kind) {
    case 'cover':
      content = <CoverPage onOpen={onOpenCover} />
      break
    case 'inside':
      content = <InsideCoverPage />
      break
    case 'toc':
      content = <TocPage onJumpToArt={onJumpToArt} onJumpToFlat={onJumpToFlat} />
      break
    case 'colophon':
      content = <ColophonPage />
      break
    case 'insideback':
      content = <InsideBackPage />
      break
    case 'back':
      content = <BackCoverPage onBack={onBackCover} />
      break
    case 'art': {
      const Art = ART_COMPONENTS[page.artIndex ?? 0]
      content = Art ? <Art active={active} /> : null
      break
    }
  }

  return (
    <div className="page-surface">
      {content}
      {page.kind === 'art' && page.artIndex != null && (
        <PageBadge n={page.artIndex} total={ART_COUNT} side={side} title={page.title} />
      )}
    </div>
  )
}

export { PaperBack }
