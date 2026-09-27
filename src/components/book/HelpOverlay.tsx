'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useBookStore } from '@/lib/book-store'
import { ART_COUNT } from '@/lib/book/pages'

const CONTROLS: Array<[string, string]> = [
  ['点击页角 / 页边', '翻向下一页或上一页'],
  ['拖拽页边', '像真的纸一样跟手翻页，松手判定'],
  ['← / → 键', '键盘翻页（PgUp / PgDn 亦可）'],
  ['滚轮', '快速翻页'],
  ['Home / End', '回到封面 / 翻到读毕'],
  ['B 键 / 书签钮', '标记当前房间 · 丝带插入书页'],
  ['M 键 / 书签片', '打开书签面板 · 管理与直达'],
  ['底部刻度条', '点击任意刻度直达对应房间'],
  ['书页顶边丝带', '书签按实际页位露出顶边，点击直达'],
  ['环境音钮', '纸面底噪与房间呼吸 · 可单独关闭'],
  ['房间音色', '每个房间有专属的空气声，换房时平滑滑移'],
  ['目次页', '点击条目跳转；悬停预览房间玩法'],
  ['按住手势', '多数房间藏着「按住」的戏法——泉眼涌墨 · 磁场聚峰 · 闭眼之光 · 引力井 · 井中疾坠'],
  ['阅读档案', '目次页与版权页记录共处时长与翻页数'],
  ['翻书节奏', '目次页档案块的柱图记录每次翻开翻了几页'],
  ['印章印谱', '阅读行为解锁朱红印章 · 盖章即入谱，版权页可查'],
  ['印章进度', '未入谱的印章印着离下一枚还有多远'],
  ['房间通关', '五间可挑战房间（06·07·15·18·20）达成目标即 ✦，目次可查'],
  ['通关闪印', '达成挑战的一瞬，一枚大「通」印会砸在你眼前的书页上'],
  ['五关齐破', '五间可挑战房间全数通关 → 终章金印「極」· 目次与版权页印谱转金'],
  ['房间缩略图', '书签面板与续读提示里的迷你图案，是该房间的专属徽记'],
  ['页面钤印', '解锁的印章会落在当时读到的书页上 · 点击看来历，翻回仍在'],
  ['开书仪式', '翻开封面的一瞬，光会扫过书页'],
  ['封面预掀角', '合上书时把指针移近右下页角 · 页角会先替你掀起来'],
  ['自动记忆', '进度与书签存在本机，下次翻开可续读'],
]

export function HelpOverlay({ onBackToCover }: { onBackToCover: () => void }) {
  const helpOpen = useBookStore((s) => s.helpOpen)
  const setHelpOpen = useBookStore((s) => s.setHelpOpen)
  const visited = useBookStore((s) => s.visited)
  const readingMs = useBookStore((s) => s.readingMs)
  const flips = useBookStore((s) => s.flips)
  const min = Math.floor(readingMs / 60_000)

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="help-card max-w-[92vw] sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="help-card__title">如何翻阅这本书</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-bone/70">
            《翻》FLIP — 二十个房间。每一页是一件独立交互艺术品。
          </DialogDescription>
        </DialogHeader>

        <div className="help-grid">
          {CONTROLS.map(([k, d]) => (
            <div key={k} className="contents">
              <span className="help-grid__key">{k}</span>
              <span className="help-grid__desc">{d}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-bone/15 pt-4">
          <span className="font-attitude text-[11px] tracking-[0.2em] text-bone/60">
            已探索 {visited.length} / {ART_COUNT} 个房间
            {min > 0 && ` · 共处 ${min} 分钟 · 翻过 ${flips} 页`}
          </span>
          <button
            type="button"
            className="border border-acid/50 bg-acid/10 px-4 py-2 font-attitude text-[11px] tracking-[0.2em] text-acid transition-colors hover:bg-acid/20"
            onClick={() => {
              setHelpOpen(false)
              onBackToCover()
            }}
          >
            回到封面
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
