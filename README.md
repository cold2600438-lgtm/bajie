# 八戒 (Bajie) — AI Token 共享网关

和朋友们共享大模型 Token 套餐的代理网关。大家把买的 API Key 放进来，统一入口访问，自动轮询切换，用量透明，费用按量分摊。

## 特性

- 🔄 **多厂商支持** — Kimi (MiniMax)、GLM (智谱)、以及任何兼容 Anthropic/OpenAI 协议的厂商
- 🔌 **双协议兼容** — 同时支持 OpenAI (`/openai/v1/chat/completions`) 和 Anthropic (`/anthropic/v1/messages`) 接口
- 🔑 **Key 池管理** — 多个 API Key 自动轮询、故障切换、健康检查恢复
- 👥 **用户自注册** — 朋友注册账号时可以贡献自己的 Key 加入共享池
- 📊 **用量追踪** — 每个人用了多少 Token 一目了然，按天/周/月查看
- 💰 **费用分摊** — 根据用量自动计算每人应付费用
- 🖥️ **管理面板** — Ant Design 可视化管理界面，开箱即用
- 🔒 **安全** — API Key 加密存储 (AES-256-GCM)，日志脱敏，限流保护
- 📦 **零依赖部署** — SQLite 数据库，一个端口搞定前后端，无需 Redis/PostgreSQL

## 快速开始

### 环境要求

- Node.js >= 18
- npm

### 一键启动

```bash
git clone https://github.com/cold2600438-lgtm/bajie.git
cd bajie
./start.sh
```

启动脚本会自动：安装依赖 → 生成配置 → 构建前端 → 初始化数据库 → 启动服务

启动后访问 `http://localhost:3000` 打开管理面板。

### 手动启动

```bash
# 1. 安装后端依赖
cd ai-token-gateway
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，设置 ENCRYPTION_KEY 和 ADMIN_TOKEN

# 3. 构建前端
cd ../gateway-dashboard
npm install
npm run build

# 4. 初始化数据库
cd ../ai-token-gateway
npx tsx src/seed.ts

# 5. 启动服务
npx tsx src/index.ts
```

## 使用方式

### 1. 添加 Provider 和 API Key

通过管理面板或 API 添加你的大模型厂商和 Key：

```bash
# 管理面板方式
# 访问 http://localhost:3000，用 Admin Token 登录，在 Key 管理页面添加

# API 方式
curl -X POST http://localhost:3000/api/admin/keys \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"minimax","key":"sk-your-api-key","contributorUserId":"admin"}'
```

### 2. 朋友注册

朋友们访问 `http://localhost:3000/register` 注册账号，可以同时贡献自己的 API Key。

### 3. 接入使用

把客户端的 API 地址改成网关地址即可：

```
# Anthropic 协议（Kimi/MiniMax/GLM 等）
Base URL: http://your-server:3000/anthropic
API Key: 注册时获得的 Access Token

# OpenAI 协议
Base URL: http://your-server:3000/openai
API Key: 注册时获得的 Access Token
```

### 4. 查看用量和费用

- 用户：登录管理面板查看个人用量
- 管理员：查看所有人用量，生成费用分摊报告

## 配置说明

环境变量（`.env` 文件）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `ADMIN_TOKEN` | 管理员认证 Token | (必填) |
| `ENCRYPTION_KEY` | API Key 加密密钥 (64位hex) | (必填) |
| `DATABASE_PATH` | SQLite 数据库路径 | ./data/gateway.db |
| `RATE_LIMIT_MAX` | 每用户每分钟最大请求数 | 60 |

## API 端点

### 代理转发

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/openai/v1/chat/completions` | OpenAI 协议代理 |
| GET | `/openai/v1/models` | 模型列表 |
| POST | `/anthropic/v1/messages` | Anthropic 协议代理 |

### 用户接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/register` | 用户注册 (无需认证) |
| GET | `/api/user/profile` | 获取个人信息 |
| GET | `/api/user/usage` | 查询个人用量 |
| POST | `/api/user/reset-token` | 重置 Access Token |

### 管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户 |
| PUT | `/api/admin/users/:id/disable` | 禁用用户 |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| POST | `/api/admin/users/:id/reset-token` | 重置用户 Token |
| GET | `/api/admin/keys` | API Key 列表 |
| POST | `/api/admin/keys` | 添加 API Key |
| DELETE | `/api/admin/keys/:id` | 移除 API Key |
| GET | `/api/admin/providers` | Provider 列表 |
| PUT | `/api/admin/providers/:id/pricing` | 配置定价 |
| GET | `/api/admin/usage` | 全局用量查询 |
| POST | `/api/admin/reports/cost` | 生成费用报告 |
| GET | `/health` | 健康检查 |

## 技术栈

- 后端：Node.js + TypeScript + Fastify + SQLite
- 前端：React + TypeScript + Vite + Ant Design 5
- 测试：Vitest (244 单元测试) + Playwright (10 E2E 测试)

## 项目结构

```
bajie/
├── ai-token-gateway/     # 后端服务
│   ├── src/
│   │   ├── handlers/     # 路由处理器 (OpenAI/Anthropic/Admin/User/Health)
│   │   ├── services/     # 业务逻辑 (KeyPool/ProxyEngine/UsageTracker/CostCalculator)
│   │   ├── middleware/   # 中间件 (Auth/RateLimit/RequestLogger)
│   │   └── db/           # 数据库 (SQLite Schema/Connection)
│   └── public/           # 前端构建产物
├── gateway-dashboard/    # 前端管理面板
│   ├── src/
│   │   ├── pages/        # 页面组件
│   │   ├── components/   # 共享组件
│   │   ├── api/          # API 客户端
│   │   └── context/      # 状态管理
│   └── e2e/              # Playwright E2E 测试
└── start.sh              # 一键启动脚本
```

## License

MIT
