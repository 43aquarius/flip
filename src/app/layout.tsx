import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Archivo_Black, Space_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const archivoBlack = Archivo_Black({
  weight: "400",
  variable: "--font-archivo-black",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  variable: "--font-space-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "《翻》FLIP — 二十个房间 · 实验数字艺术书",
  description:
    "一本可以翻阅的前卫数字艺术书：封面、书脊、纸张、翻页与页码。二十个房间，每一页是一件独立交互艺术品——生成艺术、声音装置、粒子实验、视觉谜题。无需按顺序，也不必读完。",
  keywords: ["实验出版物", "数字艺术", "生成艺术", "交互艺术", "翻页书", "avant-garde", "interactive art"],
  authors: [{ name: "Z.AI PRESS" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "《翻》FLIP — 二十个房间",
    description: "一本没有文字义务的实验数字艺术书。翻开它。",
    siteName: "Z.AI PRESS",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0908",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${archivoBlack.variable} ${spaceMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
