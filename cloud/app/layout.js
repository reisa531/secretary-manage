import './globals.css';
import { Analytics } from "@vercel/analytics/next"

export const metadata = {
  title: '团支部管理平台',
  description: '团支部信息发布与投票平台',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="topbar">
          <div className="inner">
            <span className="brand">⚑ 团支部管理平台</span>
            <nav className="nav">
              <a href="/">首页</a>
            </nav>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
