#!/usr/bin/env bash
# ============================================================
# 《翻》FLIP — 单文件版一键构建
#   src/（Next.js 16 源码）→ 根目录 index.html
#   产物约 0.9MB：JS + CSS + Google Fonts(latin) 全部内嵌，
#   零外部依赖，双击即可离线翻阅，GitHub Pages 直发可用。
#
#   用法：bash standalone/build.sh   （或 bun run build:standalone）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/4] esbuild · 打包 React 应用为 IIFE..."
bunx esbuild standalone/entry.tsx \
  --bundle --minify --format=iife --target=es2017 --charset=utf8 \
  --define:process.env.NODE_ENV='"production"' \
  --tsconfig=tsconfig.json --legal-comments=eof \
  --outfile=standalone/build/app.js

echo "[2/4] Tailwind CLI · 编译全书样式（与 Next 版同一份 globals.css）..."
bunx tailwindcss -i standalone/entry.css -o standalone/build/app.css --minify

echo "[3/4] Google Fonts · latin 子集下载并 base64 内嵌..."
bun standalone/build-fonts.ts

echo "[4/4] 组装 index.html..."
rm -f index.html
bun standalone/assemble.ts

echo ""
echo "✓ 完成 → $(pwd)/index.html"
