/// <reference types="bun-types" />
/**
 * 下载 Google Fonts latin 子集（Archivo Black / Space Mono / Geist / Geist Mono）
 * 并生成 base64 内嵌的 standalone/build/fonts.css —— 单文件版离线可用的字库。
 *
 * 运行：bun standalone/build-fonts.ts
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Mono:ital,wght@0,400;0,700&family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap'

const WANT = new Set(['Archivo Black', 'Space Mono', 'Geist', 'Geist Mono'])

async function main() {
  const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`google fonts css ${res.status}`)
  const css = await res.text()

  // 逐块提取 /* latin */ 标注的 @font-face
  const re = /\/\* latin \*\/\s*(@font-face\s*\{[^}]*\})/g
  const out: string[] = []
  let m: RegExpExecArray | null
  let totalBytes = 0
  while ((m = re.exec(css)) !== null) {
    const block = m[1]
    const fam = /font-family:\s*'([^']+)'/.exec(block)?.[1]
    const style = /font-style:\s*(\w+)/.exec(block)?.[1]
    const url = /url\((https:[^)]+)\)/.exec(block)?.[1]
    if (!fam || !WANT.has(fam) || style !== 'normal' || !url) continue

    const fontRes = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!fontRes.ok) throw new Error(`woff2 ${fam} ${fontRes.status}`)
    const buf = Buffer.from(await fontRes.arrayBuffer())
    totalBytes += buf.byteLength
    const b64 = buf.toString('base64')
    out.push(block.replace(url, `data:font/woff2;base64,${b64}`))
  }

  if (out.length < 5) throw new Error(`only ${out.length} latin faces extracted (expect >=5)`)

  // next/font 变量在单文件版中的等价定义（与 layout.tsx 的字体装载对齐）
  const rootVars = `:root {
  --font-geist-sans: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-geist-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --font-archivo-black: 'Archivo Black', 'Arial Black', sans-serif;
  --font-space-mono: 'Space Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}`

  const banner = `/* —— Google Fonts latin 子集（base64 内嵌，离线可用）—— */`
  await Bun.write(
    'standalone/build/fonts.css',
    `${banner}\n${rootVars}\n${out.join('\n')}\n`,
  )
  const kb = (totalBytes / 1024).toFixed(0)
  console.log(`fonts.css 写入完成：${out.length} 个 @font-face，woff2 共 ${kb} KB`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

export {}
