# 需求文档：AI Token 共享网关管理面板

## 简介

AI Token 共享网关管理面板（Dashboard）是一个 Web 前端应用，为 AI Token 共享网关后端提供可视化管理界面。面板分为用户端和管理员端两个视图：用户可以注册、登录、查看个人用量和贡献的 Key；管理员可以管理用户、API Key、Provider 配置、查看全局用量和生成费用报告。面板通过调用已有的后端 REST API 实现所有功能。

## 术语表

- **Dashboard（管理面板）**: 本前端 Web 应用，提供网关的可视化管理界面
- **User_Panel（用户面板）**: 普通用户登录后看到的界面，包含个人用量和 Key 贡献信息
- **Admin_Panel（管理员面板）**: 管理员登录后看到的界面，包含用户管理、Key 管理、Provider 配置等功能
- **Auth_Module（认证模块）**: 负责用户注册、登录、Token 存储和身份验证的前端模块
- **API_Client（API 客户端）**: 封装所有后端 API 调用的前端模块，统一处理请求头、错误和 Token 注入
- **Access_Token（访问令牌）**: 后端为每个用户生成的唯一身份凭证，前端存储后用于所有需认证的 API 请求
- **Gateway_Backend（网关后端）**: 已有的 AI Token 共享网关后端服务，提供 REST API
- **Health_Status（健康状态）**: 通过 /health 端点获取的服务状态信息，包含各 Provider 的可用 Key 数量
- **Cost_Report（费用报告）**: 基于用量和定价生成的费用分摊报告
- **Provider（供应商）**: 大模型服务厂商，如 Kimi、MiniMax、GLM 等

## 需求

### 需求 1：用户注册与登录

**用户故事：** 作为用户，我希望通过管理面板注册账号并登录，这样我可以使用网关服务并查看个人信息。

#### 验收标准

1. THE Dashboard SHALL 提供注册页面，包含用户名输入框，以及可选的 API Key 和 Provider 选择字段
2. WHEN 用户提交注册表单时, THE Auth_Module SHALL 调用 POST /api/user/register 接口完成注册
3. WHEN 注册成功时, THE Dashboard SHALL 显示生成的 Access_Token 并提示用户妥善保存
4. WHEN 注册时用户提交了 API Key, THE Dashboard SHALL 显示该 Key 的验证结果（有效或无效）
5. IF 注册失败（用户名已存在）, THEN THE Dashboard SHALL 显示明确的错误提示信息
6. THE Dashboard SHALL 提供登录页面，包含 Access_Token 输入框
7. WHEN 用户输入 Access_Token 并提交登录时, THE Auth_Module SHALL 调用 GET /api/user/usage 接口验证 Token 有效性
8. WHEN Token 验证通过时, THE Auth_Module SHALL 将 Access_Token 存储到浏览器本地存储并跳转到对应的面板页面
9. IF Token 验证失败, THEN THE Dashboard SHALL 显示"无效的访问令牌"错误提示
10. THE Dashboard SHALL 根据用户角色（user 或 admin）自动跳转到 User_Panel 或 Admin_Panel

### 需求 2：用户个人面板

**用户故事：** 作为用户，我希望在面板中查看自己的 Token 用量，这样我可以了解自己的消耗情况。

#### 验收标准

1. THE User_Panel SHALL 显示当前用户的用量概览，包含按 Provider 分组的 prompt_tokens、completion_tokens 和 total_tokens
2. WHEN 用户进入 User_Panel 时, THE Dashboard SHALL 调用 GET /api/user/usage 接口获取用量数据，默认查询当月数据
3. THE User_Panel SHALL 提供时间范围选择器，允许用户选择查询的起止日期
4. THE User_Panel SHALL 提供时间粒度选择器，支持按天、按周、按月三种粒度查看用量
5. WHEN 用户修改时间范围或粒度时, THE Dashboard SHALL 重新调用 GET /api/user/usage 接口并更新显示
6. THE User_Panel SHALL 以表格形式展示用量数据，列包含时间段、Provider、prompt_tokens、completion_tokens 和 total_tokens
7. THE User_Panel SHALL 提供退出登录按钮，点击后清除本地存储的 Access_Token 并跳转到登录页面
8. THE User_Panel SHALL 提供"重置 Token"按钮，允许用户重新生成自己的 Access_Token
9. WHEN 用户点击"重置 Token"按钮时, THE Dashboard SHALL 显示确认对话框，提示重置后旧 Token 将立即失效
10. WHEN 用户确认重置时, THE Dashboard SHALL 调用 POST /api/user/reset-token 接口生成新 Token（需后端新增此接口）
11. WHEN Token 重置成功时, THE Dashboard SHALL 显示新的 Access_Token 并提示用户妥善保存，同时更新本地存储的 Token

### 需求 3：管理员用户管理

**用户故事：** 作为管理员，我希望在面板中管理所有用户账号，这样我可以控制谁能使用网关服务。

#### 验收标准

1. THE Admin_Panel SHALL 提供用户管理页面，以表格形式展示所有用户的 ID、用户名、角色、状态和创建时间
2. THE Admin_Panel SHALL 提供创建用户表单，包含用户名、角色选择（user/admin）和可选的 Provider 权限配置
3. WHEN 管理员提交创建用户表单时, THE Dashboard SHALL 调用 POST /api/admin/users 接口创建用户
4. WHEN 用户创建成功时, THE Dashboard SHALL 显示新用户的 Access_Token 并刷新用户列表
5. THE Admin_Panel SHALL 为每个用户提供"禁用"操作按钮
6. WHEN 管理员点击禁用按钮时, THE Dashboard SHALL 调用 PUT /api/admin/users/:id/disable 接口禁用该用户
7. THE Admin_Panel SHALL 为每个用户提供"删除"操作按钮
8. WHEN 管理员点击删除按钮时, THE Dashboard SHALL 显示确认对话框，确认后调用 DELETE /api/admin/users/:id 接口删除该用户
9. THE Admin_Panel SHALL 为每个用户提供"重置 Token"操作按钮
10. WHEN 管理员点击"重置 Token"按钮时, THE Dashboard SHALL 调用 POST /api/admin/users/:id/reset-token 接口为该用户生成新 Token（需后端新增此接口）
11. WHEN Token 重置成功时, THE Dashboard SHALL 显示新的 Access_Token 供管理员转发给用户
12. THE Admin_Panel SHALL 为每个用户提供 Provider 权限配置功能
10. WHEN 管理员修改用户的 Provider 权限时, THE Dashboard SHALL 调用 PUT /api/admin/users/:id/providers 接口更新权限
11. IF 任何管理操作失败, THEN THE Dashboard SHALL 显示后端返回的错误信息

### 需求 4：管理员 API Key 管理

**用户故事：** 作为管理员，我希望在面板中管理所有 API Key，这样我可以维护共享 Key 池的健康状态。

#### 验收标准

1. THE Admin_Panel SHALL 提供 Key 管理页面，以表格形式展示所有 API Key 的 ID、Provider、贡献者、状态、预估额度和创建时间
2. THE Admin_Panel SHALL 对 API Key 进行脱敏显示，仅展示最后 4 位字符
3. THE Admin_Panel SHALL 提供添加 Key 表单，包含 Provider 选择、API Key 输入、贡献者用户 ID 和可选的预估额度
4. WHEN 管理员提交添加 Key 表单时, THE Dashboard SHALL 调用 POST /api/admin/keys 接口添加 Key
5. THE Admin_Panel SHALL 为每个 Key 提供"移除"操作按钮
6. WHEN 管理员点击移除按钮时, THE Dashboard SHALL 显示确认对话框，确认后调用 DELETE /api/admin/keys/:id 接口移除该 Key
7. THE Admin_Panel SHALL 为每个 Key 提供状态更新功能，支持将状态设置为 active、disabled 或 exhausted
8. WHEN 管理员更新 Key 状态或预估额度时, THE Dashboard SHALL 调用 PUT /api/admin/keys/:id 接口更新 Key 信息
9. IF 添加 Key 时指定的 Provider 不存在, THEN THE Dashboard SHALL 显示"Provider 不存在"的错误提示

### 需求 5：管理员用量查看与费用报告

**用户故事：** 作为管理员，我希望查看所有用户的用量并生成费用报告，这样我可以进行费用分摊。

#### 验收标准

1. THE Admin_Panel SHALL 提供全局用量查看页面，以表格形式展示所有用户按 Provider 分组的 Token 用量
2. THE Admin_Panel SHALL 提供时间范围选择器，允许管理员选择查询的起止日期
3. WHEN 管理员选择时间范围后, THE Dashboard SHALL 调用 GET /api/admin/usage 接口获取用量数据
4. THE Admin_Panel SHALL 提供费用报告生成功能，包含时间范围选择和生成按钮
5. WHEN 管理员点击生成费用报告按钮时, THE Dashboard SHALL 调用 POST /api/admin/reports/cost 接口生成报告
6. THE Dashboard SHALL 以表格形式展示费用报告，列包含用户、Provider、prompt_tokens、completion_tokens、prompt 费用、completion 费用和总费用
7. THE Dashboard SHALL 在费用报告底部显示总费用汇总
8. THE Dashboard SHALL 支持将费用报告导出为 JSON 文件下载

### 需求 6：管理员 Provider 配置

**用户故事：** 作为管理员，我希望在面板中配置 Provider 的定价信息，这样费用计算可以基于准确的价格。

#### 验收标准

1. THE Admin_Panel SHALL 提供 Provider 配置页面，展示所有 Provider 的 ID、名称、当前 prompt 单价和 completion 单价
2. THE Admin_Panel SHALL 为每个 Provider 提供定价编辑功能，允许修改 prompt 和 completion 的每千 Token 价格
3. WHEN 管理员提交定价修改时, THE Dashboard SHALL 调用 PUT /api/admin/providers/:id/pricing 接口更新定价
4. WHEN 定价更新成功时, THE Dashboard SHALL 显示成功提示并刷新 Provider 列表
5. IF 定价更新失败（Provider 不存在）, THEN THE Dashboard SHALL 显示"Provider 不存在"的错误提示

### 需求 7：服务状态概览

**用户故事：** 作为用户或管理员，我希望在面板中看到网关服务的运行状态，这样我可以了解服务是否正常。

#### 验收标准

1. THE Dashboard SHALL 在页面顶部或侧边栏显示服务健康状态指示器
2. WHEN Dashboard 加载时, THE Dashboard SHALL 调用 GET /health 接口获取服务状态
3. THE Dashboard SHALL 根据 Health_Status 的 status 字段显示不同的状态颜色：ok 为绿色、degraded 为黄色、down 为红色
4. THE Dashboard SHALL 显示各 Provider 的可用 Key 数量和总 Key 数量
5. THE Dashboard SHALL 每 30 秒自动刷新一次健康状态数据
6. WHEN 服务状态为 degraded 或 down 时, THE Dashboard SHALL 在状态指示器旁显示警告文字

### 需求 8：API 客户端与错误处理

**用户故事：** 作为用户，我希望面板的所有操作都有清晰的反馈，这样我知道操作是否成功。

#### 验收标准

1. THE API_Client SHALL 在所有需认证的请求中自动附加 Authorization: Bearer {Access_Token} 请求头
2. THE API_Client SHALL 支持通过 x-api-key 请求头传递管理员 Token（兼容后端两种认证方式）
3. IF Gateway_Backend 返回 401 错误, THEN THE Dashboard SHALL 清除本地存储的 Access_Token 并跳转到登录页面
4. IF Gateway_Backend 返回 429 错误, THEN THE Dashboard SHALL 显示"请求过于频繁，请稍后再试"的提示
5. IF Gateway_Backend 返回 500 错误, THEN THE Dashboard SHALL 显示"服务器内部错误"的提示
6. IF Gateway_Backend 无法连接, THEN THE Dashboard SHALL 显示"无法连接到服务器"的提示
7. THE Dashboard SHALL 在所有数据加载过程中显示加载状态指示器
8. THE Dashboard SHALL 在所有表单提交过程中禁用提交按钮以防止重复提交

### 需求 9：导航与布局

**用户故事：** 作为用户，我希望面板的导航清晰直观，这样我可以快速找到需要的功能。

#### 验收标准

1. THE Dashboard SHALL 提供侧边栏导航，根据用户角色显示不同的菜单项
2. WHILE 用户角色为 user 时, THE Dashboard SHALL 在侧边栏显示"用量概览"菜单项
3. WHILE 用户角色为 admin 时, THE Dashboard SHALL 在侧边栏显示"用户管理"、"Key 管理"、"Provider 配置"、"用量查看"和"费用报告"菜单项
4. THE Dashboard SHALL 在侧边栏底部显示当前登录用户的用户名和角色
5. THE Dashboard SHALL 采用响应式布局，在桌面端和移动端均可正常使用
6. THE Dashboard SHALL 在未登录状态下仅显示登录和注册页面，隐藏所有管理功能入口
