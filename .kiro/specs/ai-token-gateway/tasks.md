# 实现计划：AI Token 共享网关

## 概述

基于 Node.js + TypeScript + Fastify + SQLite 技术栈，按模块逐步实现 AI Token 共享网关。每个任务构建在前一个任务之上，确保增量可验证。用户提供的测试 API Key：MiniMax（地址 `https://api.minimaxi.com/anthropic`，模型 `MiniMax-M2.7`）和 GLM（地址 `https://open.bigmodel.cn/api/anthropic`，模型 `glm-5`）。

## 任务

- [x] 1. 项目初始化与基础设施
  - [x] 1.1 初始化项目结构与依赖
    - 创建 `ai-token-gateway/` 项目目录，初始化 `package.json`
    - 安装依赖：`fastify`, `better-sqlite3`, `undici`, `dotenv`, `uuid`
    - 安装开发依赖：`typescript`, `vitest`, `fast-check`, `@types/better-sqlite3`
    - 创建 `tsconfig.json`，配置 `strict` 模式和 `ESNext` 模块
    - 创建 `vitest.config.ts`
    - 创建 `.env.example`，包含 `ADMIN_TOKEN`、`ENCRYPTION_KEY`、`PORT`、`DATABASE_PATH` 等环境变量
    - _需求: 7.1_

  - [x] 1.2 创建类型定义文件
    - 创建 `src/types/index.ts`，定义所有核心接口和类型
    - 包含：`ParsedProxyRequest`, `UpstreamRequest`, `ProxyResult`, `UsageInfo`, `UsageEntry`, `UsageSummary`, `ApiKeyEntry`, `CostReport`, `CostReportEntry`, `ProviderPricing`, `RegisterInput`, `RegisterResult`, `UserInfo` 等
    - _需求: 1.1, 1.2, 2.1, 3.1, 5.1, 6.1_

  - [x] 1.3 创建配置管理模块
    - 创建 `src/config.ts`，从环境变量加载配置
    - 包含：端口号、数据库路径、加密密钥、管理员 Token、限流参数等
    - 提供默认值和配置校验
    - _需求: 7.1_

  - [x] 1.4 创建数据库初始化模块
    - 创建 `src/db/schema.ts`，包含所有建表 SQL 语句（users, providers, api_keys, token_usage, request_logs）及索引
    - 创建 `src/db/database.ts`，封装 SQLite 连接初始化、建表、关闭逻辑
    - 使用 `better-sqlite3` 同步 API
    - _需求: 3.2, 5.1, 5.2, 7.2_

- [x] 2. 加密与认证模块
  - [x] 2.1 实现 API Key 加密/解密工具
    - 创建 `src/services/crypto.ts`
    - 使用 AES-256-GCM 算法加密存储 API Key
    - 实现 `encrypt(plaintext: string): EncryptedData` 和 `decrypt(data: EncryptedData): string`
    - _需求: 8.2_

  - [ ]* 2.2 编写加密往返一致性属性测试
    - 创建 `tests/properties/crypto.property.test.ts`
    - **属性 P6: API Key 加密往返一致性**
    - 使用 fast-check 生成随机字符串，验证 `decrypt(encrypt(K)) === K`
    - **验证: 需求 8.2**

  - [x] 2.3 实现认证中间件
    - 创建 `src/middleware/auth.ts`
    - 从请求 Header（`Authorization: Bearer <token>` 或 `x-api-key`）提取用户 Token
    - 查询数据库验证 Token 有效性和用户状态
    - 区分 User 和 Admin 角色
    - 无效/禁用 Token 返回 401
    - _需求: 2.7, 2.8, 8.1_

  - [ ]* 2.4 编写认证不可绕过性属性测试
    - 创建 `tests/properties/auth.property.test.ts`
    - **属性 P7: 认证不可绕过性**
    - 使用 fast-check 生成随机无效 Token，验证受保护端点返回 401
    - **验证: 需求 2.8, 8.1**

- [x] 3. 限流模块
  - [x] 3.1 实现滑动窗口限流器
    - 创建 `src/middleware/rate-limiter.ts`
    - 基于内存中的滑动窗口算法，每用户每分钟最多 60 次请求
    - 超限返回 429 状态码，响应头包含 `Retry-After` 和 `X-RateLimit-Remaining`
    - _需求: 8.4_

  - [ ]* 3.2 编写限流准确性属性测试
    - 创建 `tests/properties/rate-limiter.property.test.ts`
    - **属性 P5: 限流准确性**
    - 使用 fast-check 生成随机请求时间序列，验证 60 秒窗口内不超过 60 次
    - **验证: 需求 8.4**

- [x] 4. 检查点 - 基础设施验证
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 5. 用户管理模块
  - [x] 5.1 实现用户管理服务
    - 创建 `src/services/user-manager.ts`
    - 实现用户自注册：生成 UUID 作为 userId，生成随机 access_token
    - 实现管理员创建/禁用/删除用户
    - 实现 Provider 权限配置（allowed_providers JSON 数组）
    - 实现 Token 验证和 Provider 访问权限检查
    - _需求: 2.1, 2.2, 2.6, 2.9, 2.10_

  - [x] 5.2 实现用户相关 HTTP 接口
    - 创建 `src/handlers/user.ts`，实现 `POST /api/user/register` 自注册端点
    - 创建 `src/handlers/admin.ts`，实现用户管理端点：
      - `POST /api/admin/users` 创建用户
      - `PUT /api/admin/users/:id/disable` 禁用用户
      - `DELETE /api/admin/users/:id` 删除用户
      - `PUT /api/admin/users/:id/providers` 配置 Provider 权限
    - _需求: 2.1, 2.6, 2.9_

- [x] 6. Key 池管理模块
  - [x] 6.1 实现 Key 池管理器
    - 创建 `src/services/key-pool.ts`
    - 实现 Key 的添加（加密存储）、移除、更新
    - 实现轮询策略：内存中维护每个 Provider 的轮询索引
    - 实现故障标记：连续 3 次失败后移出轮询
    - 实现成功标记：重置失败计数
    - 实现健康检查：恢复可用 Key
    - _需求: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.4, 4.5_

  - [ ]* 6.2 编写 Key 轮询公平性属性测试
    - 创建 `tests/properties/key-pool.property.test.ts`
    - **属性 P1: Key 轮询公平性**
    - 使用 fast-check 生成 1-20 个随机 Key，验证 N 次请求后每个 Key 恰好被选中 1 次
    - **验证: 需求 4.4**

  - [ ]* 6.3 编写故障隔离性属性测试
    - 在 `tests/properties/key-pool.property.test.ts` 中追加
    - **属性 P2: 故障隔离性**
    - 验证连续 3 次失败后 Key 不再出现在轮询结果中
    - **验证: 需求 4.5**

  - [x] 6.4 实现 Key 验证器
    - 创建 `src/services/key-validator.ts`
    - 向 Provider API 发送轻量级请求验证 Key 有效性
    - 用于注册时验证用户提交的 Key 和健康检查
    - _需求: 2.3, 2.4, 2.5, 4.6_

  - [x] 6.5 实现 Key 管理 HTTP 接口
    - 在 `src/handlers/admin.ts` 中追加 Key 管理端点：
      - `POST /api/admin/keys` 添加 API Key
      - `DELETE /api/admin/keys/:id` 移除 API Key
      - `PUT /api/admin/keys/:id` 更新 API Key
    - 注册时提交 Key 的逻辑集成到 `POST /api/user/register`
    - _需求: 3.1, 3.3, 3.5_

- [x] 7. 检查点 - 用户与 Key 管理验证
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 8. 代理引擎与协议处理器
  - [x] 8.1 实现 OpenAI 协议处理器
    - 创建 `src/handlers/openai.ts`
    - 实现 `parseRequest`：从请求体提取 model、messages、stream、tools、max_tokens 等参数
    - 实现 `buildUpstreamRequest`：构建发往 Provider 的 HTTP 请求，附加 API Key 到 `Authorization` Header
    - 实现 `parseResponse`：从响应中提取 usage（prompt_tokens, completion_tokens, total_tokens）
    - 实现 `handleStream`：逐块转发 SSE 流式响应，从最终 chunk 中提取 usage
    - 路由：`POST /openai/v1/chat/completions`、`GET /openai/v1/models`
    - _需求: 1.1, 1.3, 1.6, 1.8_

  - [x] 8.2 实现 Anthropic 协议处理器
    - 创建 `src/handlers/anthropic.ts`
    - 实现 `parseRequest`：从请求体提取 model、messages、stream、tools、max_tokens 等参数
    - 实现 `buildUpstreamRequest`：构建发往 Provider 的 HTTP 请求，附加 `x-api-key` 和 `anthropic-version` Header
    - 实现 `parseResponse`：从 Anthropic 响应格式中提取 usage
    - 实现 `handleStream`：逐块转发 Anthropic SSE 流式响应（event: message_start/content_block_delta/message_delta），从 message_delta 中提取 usage
    - 路由：`POST /anthropic/v1/messages`
    - _需求: 1.2, 1.3, 1.6, 1.8_

  - [x] 8.3 实现代理引擎核心
    - 创建 `src/services/proxy-engine.ts`
    - 使用 `undici` 发送 HTTP 请求到 Provider API
    - 实现自动重试逻辑：遇到 429/402 错误时从 Key 池获取下一个 Key 重试
    - 最大重试次数 = Key 池大小
    - 所有 Key 不可用时返回 503
    - 在响应头中附加 `X-Provider` 和 `X-Key-Id`（脱敏，仅最后 4 位）
    - _需求: 1.4, 1.5, 1.7, 1.9, 4.1, 4.2, 4.3_

  - [ ]* 8.4 编写自动重试幂等性属性测试
    - 创建 `tests/properties/proxy-engine.property.test.ts`
    - **属性 P8: 自动重试幂等性**
    - 模拟多个 Key 依次失败场景，验证最终只产生一条用量记录
    - **验证: 需求 4.1, 4.2**

- [x] 9. 用量追踪与费用计算
  - [x] 9.1 实现用量追踪器
    - 创建 `src/services/usage-tracker.ts`
    - 实现 `record(entry)`：将用量写入 token_usage 表
    - 实现 `getUserUsage(userId, timeRange, granularity)`：按天/周/月汇总用户用量
    - 实现 `getAllUsage(timeRange)`：管理员查询所有用户用量
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 9.2 编写用量记录完整性属性测试
    - 创建 `tests/properties/usage-tracker.property.test.ts`
    - **属性 P3: 用量记录完整性**
    - 使用 fast-check 生成随机 usage 数据，验证记录的 token 数量与输入一致
    - **验证: 需求 5.1, 5.2**

  - [x] 9.3 实现费用计算器
    - 创建 `src/services/cost-calculator.ts`
    - 实现 Provider 定价配置（prompt/completion 每千 Token 单价）
    - 实现 `generateReport(timeRange)`：基于用量和单价计算每用户费用
    - 输出 JSON 格式的费用报告
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 9.4 编写费用计算一致性属性测试
    - 在 `tests/properties/usage-tracker.property.test.ts` 中追加
    - **属性 P4: 费用计算一致性**
    - 使用 fast-check 生成随机用量和定价，验证费用 = promptTokens × promptPrice/1000 + completionTokens × completionPrice/1000
    - **验证: 需求 6.2**

  - [x] 9.5 实现用量与费用 HTTP 接口
    - 在 `src/handlers/user.ts` 中追加 `GET /api/user/usage` 端点
    - 在 `src/handlers/admin.ts` 中追加：
      - `GET /api/admin/usage` 查询所有用户用量
      - `PUT /api/admin/providers/:id/pricing` 配置 Provider 定价
      - `POST /api/admin/reports/cost` 生成费用报告
    - _需求: 5.3, 5.5, 6.1, 6.2, 6.5_

- [x] 10. 检查点 - 核心功能验证
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 11. 应用组装与健康检查
  - [x] 11.1 实现健康检查端点
    - 创建 `src/handlers/health.ts`
    - 实现 `GET /health`，返回服务状态和各 Provider Key 池的可用 Key 数量
    - _需求: 7.4_

  - [x] 11.2 实现请求日志中间件
    - 在 `src/middleware/` 下创建请求日志记录逻辑
    - 记录每次请求的 user_id、provider_id、method、path、status_code、duration_ms
    - API Key 在日志中脱敏处理（仅显示最后 4 位）
    - _需求: 7.2, 7.3, 8.3_

  - [x] 11.3 组装 Fastify 应用与路由注册
    - 创建 `src/app.ts`：初始化 Fastify 实例，注册所有中间件和路由
    - 创建 `src/index.ts`：应用入口，加载配置、初始化数据库、启动服务
    - 启动时验证所有已配置 API Key 的可用性
    - 注册全局错误处理器，未预期错误返回 500 并记录堆栈
    - _需求: 7.1, 7.3, 7.5_

  - [x] 11.4 配置测试用 Provider 数据
    - 在数据库初始化或种子脚本中预置两个 Provider：
      - MiniMax: `api_base_url = https://api.minimaxi.com/anthropic`，模型 `MiniMax-M2.7`
      - GLM: `api_base_url = https://open.bigmodel.cn/api/anthropic`，模型 `glm-5`
    - 使用用户提供的 API Key 进行端到端验证
    - _需求: 1.4_

- [ ] 12. 集成测试与端到端验证
  - [ ]* 12.1 编写 OpenAI 协议集成测试
    - 创建 `tests/integration/openai-proxy.test.ts`
    - 测试非流式和流式请求的完整代理流程
    - 验证响应格式符合 OpenAI 协议
    - 验证用量记录正确写入
    - **验证: 需求 1.1, 1.6, 5.1**

  - [ ]* 12.2 编写 Anthropic 协议集成测试
    - 创建 `tests/integration/anthropic-proxy.test.ts`
    - 测试非流式和流式请求的完整代理流程
    - 验证响应格式符合 Anthropic 协议
    - 验证用量记录正确写入
    - **验证: 需求 1.2, 1.6, 5.1**

- [x] 13. 最终检查点 - 全部测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的子任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了对应的需求编号，确保可追溯性
- 检查点任务用于阶段性验证，确保增量开发的正确性
- 属性测试验证系统的通用正确性属性，单元测试验证具体场景和边界条件
- 测试用 API Key（MiniMax 和 GLM）仅用于开发阶段的端到端验证
