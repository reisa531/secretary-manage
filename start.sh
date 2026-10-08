#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "============================================"
echo "  团支部管理平台 正在启动..."
echo "  浏览器访问 http://localhost:8081"
echo "  默认密码 admin123"
echo "============================================"
node server.js
