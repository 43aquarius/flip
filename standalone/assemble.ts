/// <reference types="bun-types" />
/**
 * 组装《翻》FLIP 单文件版：standalone/build/{fonts.css, app.css, app.js} + public/logo.svg
 * → 根目录 index.html（零外部依赖，可双击离线打开 / GitHub Pages 直发）。
 *
 * 前置步骤（顺序执行）：
 *   1. bunx esbuild standalone/entry.tsx  --bundle --minify --format=iife ... --outfile=standalone/build/app.js
 *   2. bunx tailwindcss -i standalone/entry.css -o standalone/build/app.css --minify
 *   3. bun standalone/build-fonts.ts
 *   4. bun standalone/assemble.ts
 *
 * 运行：bun standalone/assemble.ts
 */

const TITLE = '《翻》FLIP — 二十个房间 · 实验数字艺术书'
const DESCRIPTION =
  '一本可以翻阅的前卫数字艺术书：封面、书脊、纸张、翻页与页码。二十个房间，每一页是一件独立交互艺术品——生成艺术、声音装置、粒子实验、视觉谜题。无需按顺序，也不必读完。'

async function main() {
  const [fontsCss, appCss, appJs, logoSvg] = await Promise.all([
    Bun.file('standalone/build/fonts.css').text(),
    Bun.file('standalone/build/app.css').text(),
    Bun.file('standalone/build/app.js').text(),
    Bun.file('public/logo.svg').text(),
  ])

  // 内联脚本安全转义：防止 JS 字符串中出现 </script> 提前闭合标签
  const jsSafe = appJs.replace(/<\/script/gi, '<\\/script')

  // favicon：logo.svg 以 data URI 内嵌（单文件、零外链）
  const favicon = `data:image/svg+xml;base64,${Buffer.from(logoSvg, 'utf-8').toString('base64')}`

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}" />
<meta name="keywords" content="实验出版物, 数字艺术, 生成艺术, 交互艺术, 翻页书, avant-garde, interactive art" />
<meta name="author" content="Z.AI PRESS" />
<meta name="theme-color" content="#0b0908" />
<meta name="generator" content="FLIP standalone build (esbuild + Tailwind CLI)" />
<meta property="og:title" content="《翻》FLIP — 二十个房间" />
<meta property="og:description" content="一本没有文字义务的实验数字艺术书。翻开它。" />
<meta property="og:site_name" content="Z.AI PRESS" />
<meta property="og:type" content="website" />
<link rel="icon" href="${favicon}" />
<style>
${fontsCss}
</style>
<style>
${appCss}
</style>
</head>
<body class="antialiased bg-background text-foreground">
<div id="root"></div>
<script>
${jsSafe}
</script>
</body>
</html>
`

  await Bun.write('index.html', html)
  const kb = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(0)
  console.log(`index.html 组装完成：${kb} KB（css ${(appCss.length / 1024).toFixed(0)} KB + js ${(appJs.length / 1024).toFixed(0)} KB + fonts）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

export {}
