#!/bin/bash
set -e

echo "🐷 八戒 (Bajie) — AI Token 共享网关"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 需要 Node.js >= 18，请先安装: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 版本过低 ($(node -v))，需要 >= 18"
  exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Install backend dependencies
echo ""
echo "📦 安装后端依赖..."
cd ai-token-gateway
npm install --silent
echo -e "${GREEN}✓${NC} 后端依赖安装完成"

# Generate .env if not exists
if [ ! -f .env ]; then
  echo ""
  echo "🔧 生成配置文件..."
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ADMIN_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env << EOF
ADMIN_TOKEN=${ADMIN_TOKEN}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
PORT=3000
DATABASE_PATH=./data/gateway.db
RATE_LIMIT_MAX=60
RATE_LIMIT_WINDOW_MS=60000
EOF
  echo -e "${GREEN}✓${NC} 配置文件已生成: ai-token-gateway/.env"
  echo -e "${YELLOW}⚠${NC}  Admin Token: ${ADMIN_TOKEN}"
  echo "   请妥善保存此 Token，用于管理面板登录"
else
  echo -e "${GREEN}✓${NC} 配置文件已存在"
fi

cd ..

# Install frontend dependencies and build
echo ""
echo "🎨 构建前端管理面板..."
cd gateway-dashboard
npm install --silent
npm run build 2>&1 | tail -1
cd ..
echo -e "${GREEN}✓${NC} 前端构建完成"

# Seed database
echo ""
echo "🗄️  初始化数据库..."
cd ai-token-gateway
mkdir -p data
npx tsx src/seed.ts 2>&1 | grep -E "^(✓|---|Admin)" | head -5
cd ..
echo -e "${GREEN}✓${NC} 数据库初始化完成"

# Start server
echo ""
echo "======================================"
echo -e "${GREEN}🚀 启动服务...${NC}"
echo "   管理面板: http://localhost:3000"
echo "   健康检查: http://localhost:3000/health"
echo "   OpenAI 代理: http://localhost:3000/openai/v1/chat/completions"
echo "   Anthropic 代理: http://localhost:3000/anthropic/v1/messages"
echo ""
echo "   按 Ctrl+C 停止服务"
echo "======================================"
echo ""

cd ai-token-gateway
exec npx tsx src/index.ts
