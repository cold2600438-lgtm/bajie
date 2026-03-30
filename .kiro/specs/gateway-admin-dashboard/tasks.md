# 实现计划：AI Token 共享网关管理面板

## 概述

基于 React + TypeScript + Vite + Ant Design 技术栈，实现网关管理面板。分为后端 API 补充和前端实现两大阶段。

## 任务

- [x] 1. 后端 API 补充
  - [x] 1.1 新增后端接口
    - 在 `ai-token-gateway/src/handlers/user.ts` 中新增：
      - `POST /api/user/reset-token` — 用户重置自己的 Token
      - `GET /api/user/profile` — 获取当前用户信息（含角色）
    - 在 `ai-token-gateway/src/handlers/admin.ts` 中新增：
      - `POST /api/admin/users/:id/reset-token` — 管理员重置用户 Token
      - `GET /api/admin/users` — 获取所有用户列表
      - `GET /api/admin/keys` — 获取所有 API Key 列表（脱敏）
      - `GET /api/admin/providers` — 获取所有 Provider 列表
    - 在 `ai-token-gateway/src/services/user-manager.ts` 中新增 `resetToken(userId)` 方法
    - _需求: 2.8, 2.10, 3.1, 3.9, 4.1, 6.1_

  - [x] 1.2 后端支持静态文件服务
    - 安装 `@fastify/static` 依赖
    - 在 `ai-token-gateway/src/app.ts` 中注册静态文件插件，服务 `public/` 目录
    - 配置 SPA fallback：所有非 API 路由返回 `index.html`
    - _需求: 设计决策 1_

- [ ] 2. 前端项目初始化
  - [x] 2.1 初始化前端项目
    - 在 `gateway-dashboard/` 目录创建 Vite + React + TypeScript 项目
    - 安装依赖：`react`, `react-dom`, `react-router-dom`, `antd`, `@ant-design/icons`
    - 配置 `vite.config.ts`：proxy 开发时 API 请求到 `localhost:3000`
    - 创建 `src/types/index.ts` 前端类型定义
    - _需求: 设计文档_

- [x] 3. API 客户端与认证
  - [x] 3.1 实现 API Client 和 Auth Context
    - 创建 `src/api/client.ts`：封装 fetch，自动注入 Token，统一错误处理
    - 创建 `src/context/AuthContext.tsx`：管理认证状态，提供 login/logout/resetToken
    - 实现 401 自动登出、429/500 错误提示
    - _需求: 1.7, 1.8, 1.9, 8.1, 8.3, 8.4, 8.5, 8.6_

- [x] 4. 页面实现
  - [x] 4.1 登录和注册页面
    - 创建 `src/pages/LoginPage.tsx`：Token 输入 + 登录按钮
    - 创建 `src/pages/RegisterPage.tsx`：用户名 + 可选 API Key/Provider + 注册
    - 注册成功后显示 Token 并提示保存
    - _需求: 1.1-1.10_

  - [x] 4.2 布局和路由
    - 创建 `src/App.tsx`：React Router 配置 + 路由守卫
    - 创建 `src/components/Layout.tsx`：Ant Design Layout + Sider 侧边栏
    - 创建 `src/components/HealthBadge.tsx`：服务状态指示器
    - 根据角色显示不同菜单，未登录重定向到 /login
    - _需求: 7.1-7.6, 9.1-9.6_

  - [x] 4.3 用户面板
    - 创建 `src/pages/UserDashboard.tsx`
    - 用量表格（Ant Design Table）+ 时间范围选择（RangePicker）+ 粒度选择（Select）
    - 重置 Token 按钮 + 确认对话框 + Token 显示
    - 退出登录按钮
    - _需求: 2.1-2.11_

  - [x] 4.4 管理员 - 用户管理
    - 创建 `src/pages/AdminUsers.tsx`
    - 用户列表表格 + 创建用户表单（Modal）
    - 禁用/删除/重置 Token 操作按钮
    - Provider 权限配置
    - _需求: 3.1-3.12_

  - [x] 4.5 管理员 - Key 管理
    - 创建 `src/pages/AdminKeys.tsx`
    - Key 列表表格（脱敏显示）+ 添加 Key 表单（Modal）
    - 移除/状态更新操作
    - _需求: 4.1-4.9_

  - [x] 4.6 管理员 - Provider 配置
    - 创建 `src/pages/AdminProviders.tsx`
    - Provider 列表 + 定价编辑（行内编辑或 Modal）
    - _需求: 6.1-6.5_

  - [x] 4.7 管理员 - 用量查看与费用报告
    - 创建 `src/pages/AdminUsage.tsx`：全局用量表格 + 时间范围选择
    - 创建 `src/pages/AdminCost.tsx`：费用报告生成 + 表格展示 + JSON 导出
    - _需求: 5.1-5.8_

- [x] 5. 构建与集成
  - [x] 5.1 构建并集成到后端
    - 配置 `vite.config.ts` 的 `build.outDir` 指向 `../ai-token-gateway/public`
    - 执行构建，验证静态文件正确输出
    - 启动后端服务，验证前端页面可通过 `http://localhost:3000` 访问
    - 端到端验证：注册、登录、查看用量、管理用户/Key/Provider、生成费用报告
    - _需求: 全部_
