/**
 * 艺术页（房间）组件统一契约。
 * 书壳会在页面不可见时传 active=false —— 此时组件应：
 *   - 停止 requestAnimationFrame 动画循环
 *   - 停止一切音频输出
 *   - 但保留 canvas 与作品状态（可见的是冻结的一帧）
 * active 重新变为 true 时恢复动画。组件卸载时彻底清理所有资源。
 */
export interface ArtPageProps {
  active: boolean
}
