# 需求文档：AI Token 共享网关

## 简介

AI Token 共享网关是一个代理服务，允许一组用户共享多个大模型厂商（Kimi、MiniMax、GLM 等）的 Token 套餐。该服务同时兼容 OpenAI 和 Anthropic 两种主流 API 接口协议，提供统一的 API 入口，自动管理和切换后端 API Key，追踪每位用户的 Token 用量，并支持按用量分摊费用。用户可以自行注册并贡献自己的 API Key 到共享池中。目标是让朋友间共享 AI 资源变得简单、稳定、透明。

## 术语表

- **Gateway（网关）**: 核心代理服务，接收用户请求并转发至后端大模型 API，支持 OpenAI 和 Anthropic 两种接口协议
- **User（用户）**: 通过网关访问大模型服务的个人，拥有独立账号，可自行注册并贡献 API Key
- **Admin（管理员）**: 管理网关配置、用户账号和 API Key 的操作者
- **API_Key（密钥）**: 大模型厂商提供的访问凭证，关联特定的 Token 额度
- **Provider（供应商）**: 大模型服务厂商，包括 Kimi、MiniMax、GLM 等通过地址和 API Key 提供服务的厂商
- **Key_Pool（密钥池）**: 同一供应商下多个 API Key 的集合，用于负载均衡和故障切换
- **Token_Usage（用量记录）**: 记录每次请求消耗的 Token 数量，关联到具体用户和供应商
- **Cost_Report（费用报告）**: 基于用量记录生成的费用分摊报告
- **Health_Check（健康检查）**: 定期检测 API Key 可用性和剩余额度的机制
- **OpenAI_Protocol（OpenAI 协议）**: OpenAI 风格的 API 接口格式，使用 /v1/chat/completions 等端点
- **Anthropic_Protocol（Anthropic 协议）**: Anthropic 风格的 API 接口格式，使用 /v1/messages 等端点

## 需求

### 需求 1：API 请求代理转发

**用户故事：** 作为用户，我希望通过统一的网关地址访问多个大模型服务，这样我不需要关心后端使用的是哪个厂商的 API Key，也不需要关心接口协议的差异。

#### 验收标准

1. WHEN 用户发送符合 OpenAI_Protocol 格式的 API 请求, THE Gateway SHALL 将请求转发至用户指定的 Provider 并返回符合 OpenAI_Protocol 格式的响应
2. WHEN 用户发送符合 Anthropic_Protocol 格式的 API 请求, THE Gateway SHALL 将请求转发至用户指定的 Provider 并返回符合 Anthropic_Protocol 格式的响应
3. THE Gateway SHALL 通过 URL 路径前缀区分接口协议：以 /openai/ 开头的路径使用 OpenAI_Protocol，以 /anthropic/ 开头的路径使用 Anthropic_Protocol
4. THE Gateway SHALL 支持 Kimi、MiniMax、GLM 等 Provider 的 API 转发
5. WHEN 用户未指定 Provider, THE Gateway SHALL 使用管理员配置的默认 Provider 进行转发
6. THE Gateway SHALL 支持流式（streaming）和非流式两种响应模式
7. WHEN Gateway 转发请求时, THE Gateway SHALL 在响应头中附加实际使用的 Provider 和 API_Key 标识信息（脱敏）
8. THE Gateway SHALL 支持 function calling 和 tool use 相关的 API 参数转发
9. THE Gateway SHALL 支持最大 128K Token 的上下文窗口请求转发

### 需求 2：用户账号管理

**用户故事：** 作为用户，我希望自己注册账号并贡献 API Key 加入共享；作为管理员，我希望管理所有用户账号。

#### 验收标准

1. THE Gateway SHALL 提供用户自注册接口，允许新用户创建账号
2. WHEN User 自注册时, THE Gateway SHALL 为该 User 生成唯一的访问 Token
3. WHEN User 自注册时提交 API_Key, THE Gateway SHALL 调用对应 Provider 的 API 验证该 Key 的有效性
4. IF User 提交的 API_Key 验证通过, THEN THE Gateway SHALL 将该 Key 加入对应 Provider 的 Key_Pool 并记录 Key 的贡献者信息
5. IF User 提交的 API_Key 验证失败, THEN THE Gateway SHALL 返回明确的错误信息并拒绝该 Key 的加入
6. THE Admin SHALL 通过管理接口创建、禁用和删除 User 账号
7. WHEN User 使用有效的访问 Token 发送请求时, THE Gateway SHALL 验证身份并允许访问
8. IF User 使用无效或已禁用的访问 Token 发送请求, THEN THE Gateway SHALL 返回 401 未授权错误
9. THE Admin SHALL 为每个 User 配置可访问的 Provider 列表
10. IF User 请求访问未授权的 Provider, THEN THE Gateway SHALL 返回 403 禁止访问错误

### 需求 3：API Key 池管理

**用户故事：** 作为管理员，我希望管理多个厂商的多个 API Key，这样可以充分利用大家购买的 Token 套餐；作为用户，我希望贡献自己的 Key 到共享池。

#### 验收标准

1. THE Admin SHALL 通过管理接口添加、移除和更新每个 Provider 的 API_Key
2. THE Gateway SHALL 为每个 Provider 维护独立的 Key_Pool
3. WHEN Admin 或 User 添加 API_Key 时, THE Gateway SHALL 记录该 Key 的贡献者信息和预估额度
4. THE Gateway SHALL 支持同一 Provider 下配置至少 10 个 API_Key
5. WHEN User 通过自注册或账号设置提交 API_Key 时, THE Gateway SHALL 验证该 Key 有效后将其加入 Key_Pool

### 需求 4：自动切换与负载均衡

**用户故事：** 作为用户，我希望当一个 API Key 不可用时服务能自动切换到其他可用的 Key，这样我的请求不会中断。

#### 验收标准

1. WHEN 当前 API_Key 返回额度耗尽错误时, THE Gateway SHALL 自动切换到同一 Provider 的 Key_Pool 中下一个可用的 API_Key 并重试请求
2. WHEN 当前 API_Key 返回速率限制错误时, THE Gateway SHALL 自动切换到同一 Provider 的 Key_Pool 中下一个可用的 API_Key 并重试请求
3. IF 同一 Provider 的 Key_Pool 中所有 API_Key 均不可用, THEN THE Gateway SHALL 返回 503 服务不可用错误并附带明确的错误信息
4. THE Gateway SHALL 使用轮询策略在同一 Provider 的 Key_Pool 中分配请求
5. WHEN API_Key 连续失败 3 次时, THE Gateway SHALL 将该 Key 标记为不可用并从轮询中移除
6. THE Health_Check SHALL 每 5 分钟检测一次被标记为不可用的 API_Key，恢复可用的 Key 到轮询池中

### 需求 5：用量追踪

**用户故事：** 作为用户，我希望查看自己的 Token 使用量，这样我可以了解自己的消耗情况。

#### 验收标准

1. WHEN Gateway 完成一次请求转发时, THE Gateway SHALL 记录该请求的 prompt_tokens、completion_tokens 和 total_tokens
2. THE Token_Usage SHALL 关联请求的 User、Provider、API_Key 和时间戳
3. WHEN User 查询用量时, THE Gateway SHALL 返回该 User 按 Provider 分组的 Token 用量汇总
4. THE Gateway SHALL 支持按天、按周、按月三种时间粒度查询用量
5. THE Admin SHALL 查询所有 User 的用量汇总数据

### 需求 6：费用分摊

**用户故事：** 作为管理员，我希望根据每个人的用量自动计算费用分摊，这样谁用得多谁就多承担费用。

#### 验收标准

1. THE Admin SHALL 为每个 Provider 配置 Token 单价（每千 Token 的价格，区分 prompt 和 completion）
2. WHEN Admin 请求生成 Cost_Report 时, THE Gateway SHALL 基于 Token_Usage 和配置的单价计算每个 User 的费用
3. THE Cost_Report SHALL 包含每个 User 按 Provider 分组的 Token 用量和对应费用
4. THE Cost_Report SHALL 包含指定时间范围内的费用汇总
5. THE Gateway SHALL 支持导出 Cost_Report 为 JSON 格式

### 需求 7：服务稳定性与监控

**用户故事：** 作为管理员，我希望网关服务稳定可靠，这样朋友们可以随时使用。

#### 验收标准

1. THE Gateway SHALL 在单次请求转发中的额外延迟不超过 100 毫秒
2. THE Gateway SHALL 记录所有请求的访问日志，包含 User、Provider、响应状态码和耗时
3. IF Gateway 发生未预期的内部错误, THEN THE Gateway SHALL 返回 500 错误并记录完整的错误堆栈信息
4. THE Gateway SHALL 提供 /health 端点，返回服务状态和各 Provider Key_Pool 的可用 Key 数量
5. WHEN Gateway 启动时, THE Gateway SHALL 验证所有已配置的 API_Key 的可用性并记录结果

### 需求 8：安全性

**用户故事：** 作为管理员，我希望网关服务的访问是安全的，这样不会被未授权的人滥用。

#### 验收标准

1. THE Gateway SHALL 对所有管理接口要求 Admin 身份验证
2. THE Gateway SHALL 对存储的 API_Key 进行加密存储
3. THE Gateway SHALL 在日志和响应中对 API_Key 进行脱敏处理，仅显示最后 4 位字符
4. IF 同一 User 在 1 分钟内发送超过 60 次请求, THEN THE Gateway SHALL 对该 User 进行限流并返回 429 错误
5. THE Gateway SHALL 通过 HTTPS 与后端 Provider API 通信
