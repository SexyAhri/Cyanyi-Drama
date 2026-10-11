# Cyanyi Drama

Cyanyi Drama 是面向 AI 漫剧和短剧创作的 Web 工作台。它把文本创作、角色与场景资产、分镜、镜头、声音和成片交付放在同一个项目流程里，也提供独立的 AI 对话与媒体生成入口。

> 项目仍在持续开发中。生产结果依赖管理员配置的模型、服务商权限和账号额度。

## 功能概览

- **AI 对话与媒体生成**：通过可配置渠道使用文本、图片和视频模型。
- **漫剧项目工作区**：按编剧、资产、分镜、镜头、声音、交付六个阶段管理项目。
- **工作流与任务管理**：展示执行进度、失败原因和 Trace；支持暂停、恢复、取消和重试。
- **项目资产管理**：组织角色、场景、道具、分镜与媒体素材，并记录素材来源和所属项目。
- **渠道和模型配置**：按渠道维护 Base URL、API Key、模型及媒体能力；模型列表来自服务商接口。
- **账号与管理功能**：支持匿名 Session、邮箱密码、可选邮箱验证码，以及 GitHub 和 LinuxDO OAuth；管理员可配置系统渠道、登录方式和计费。
- **中英文界面**：应用提供中文和英文界面文案。

## 页面入口

| 路径 | 用途 |
| --- | --- |
| `/` | 产品首页 |
| `/chat` | AI 对话、图片与视频生成 |
| `/projects` | 漫剧项目列表 |
| `/projects/:projectId` | 项目制作工作区 |
| `/login` | 登录和注册 |
| `/admin` | 管理员工作区 |

项目工作区会把剧集、制作阶段和当前选择保留在导航状态中。完成账号注册时，当前浏览器的匿名项目数据会迁移到新账号。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| Web 应用 | Next.js 16 App Router、React 19、TypeScript |
| UI | Tailwind CSS 4、shadcn/ui、Base UI |
| AI 与工作流 | Vercel AI SDK、LangGraph |
| 模型协议 | OpenAI Compatible、Anthropic、Google Gemini、Volcengine Ark |
| 业务数据 | PostgreSQL 17、Prisma |
| 后台任务 | Redis 7、BullMQ、独立 Worker |
| 媒体数据 | PostgreSQL `bytea`；接口按需返回 Base64 Data URL |

## 本地运行

### 环境要求

- Node.js 20 或更高版本
- pnpm（版本见 `package.json` 的 `packageManager`）
- Docker 和 Docker Compose

### 启动依赖服务

```bash
pnpm install
docker compose up -d
```

Compose 会启动本地 PostgreSQL 和 Redis。复制环境变量示例：

```bash
# macOS / Linux
cp .env.example .env.local

# PowerShell
Copy-Item .env.example .env.local
```

本地示例配置使用 Compose 的数据库地址。生产环境必须设置唯一且高强度的 `APP_SECRET`，并使用自己的 `DATABASE_URL`、`REDIS_URL` 和 `APP_BASE_URL`。

### 初始化数据库并启动

```bash
pnpm exec prisma migrate deploy
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

图片、视频、声音生成和后台工作流需要单独运行 Worker：

```bash
pnpm worker
```

开发时保持 Web 应用和 Worker 使用相同的数据库、Redis 与应用密钥配置。

## 模型与服务配置

启动后，在应用设置中配置模型渠道的协议、Base URL、API Key 和模型；管理员还可以在管理工作区配置系统渠道、注册登录方式、SMTP 和支付服务。密钥只在服务端使用，读取设置时不会返回密钥原文。

常用环境变量：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接地址 |
| `REDIS_URL` | Redis 地址，供任务队列及登录限流使用 |
| `APP_SECRET` | 加密服务端配置等敏感数据；生产环境必填 |
| `APP_BASE_URL` | OAuth 回调和对外链接使用的应用地址 |
| `AI_GATEWAY_API_KEY` | 可选的 AI Gateway 凭据 |
| `EMAIL_*` | 可选的邮箱注册验证码和 SMTP 配置 |
| `GITHUB_*`、`LINUXDO_*` | 可选的 OAuth 环境变量回退配置 |
| `EPAY_*` | 可选的易支付环境变量回退配置 |

完整变量清单及默认值见 [.env.example](.env.example)。使用 OAuth 时，服务商回调地址应配置为：

```text
{APP_BASE_URL}/api/auth/oauth/github/callback
{APP_BASE_URL}/api/auth/oauth/linuxdo/callback
```

服务商密钥也可以从管理员设置页维护。系统设置保存到数据库后，数据库中的启用状态优先；未填写的凭据仍可使用环境变量回退。

## 后台任务和数据

Web 应用负责接收请求、读写业务数据并创建任务。Redis/BullMQ 负责排队和任务事件，Worker 执行媒体生成及耗时工作流。任务状态、用量和媒体内容保存在 PostgreSQL；应用不会用伪造结果代替未配置或失败的服务商调用。

用户、匿名 Session、渠道、项目、工作流和媒体任务都保存在数据库。会话使用 HttpOnly Cookie；密码使用 scrypt 哈希；Session 凭据以哈希形式保存。OAuth 流程使用短期 state 和浏览器绑定 Cookie。登录尝试通过 Redis 按邮箱失败次数和客户端 IP 限流。

数据库结构变更通过 Prisma migration 管理：

```bash
# 开发时创建并应用迁移
pnpm db:migrate

# 部署时应用已提交的迁移
pnpm exec prisma migrate deploy

# 更新 Prisma Client
pnpm db:generate
```

`pnpm db:reset-business` 默认只预览重置范围；只有确认要清除业务数据时才追加 `-- --execute`。该脚本会保留管理员账号和系统渠道配置。

## 开发命令

```bash
pnpm dev                  # 启动 Next.js 开发服务器
pnpm worker               # 启动 BullMQ Worker
pnpm lint                 # ESLint
pnpm test                 # Vitest
pnpm exec tsc --noEmit    # TypeScript 类型检查
pnpm build                # 生产构建
```

## 代码结构

```text
app/                  页面、布局和 Next.js API 路由
components/           通用 UI、认证、管理和 Agent 界面
features/studio/      漫剧工作区及编剧、资产、分镜、镜头、声音、交付功能
hooks/                React Hooks
lib/agent/            Agent 适配器、运行时、消息与流处理
lib/providers/        模型和媒体服务商适配器
lib/server/           服务端认证、Prisma、设置和密钥处理
lib/queue/            Redis、BullMQ 队列和任务事件
lib/worker/           后台 Worker 入口
lib/workflow/         工作流契约、执行、状态和租约
prisma/               Prisma schema 和数据库迁移
scripts/              数据维护与导入脚本
docs/                 架构、集成和开发说明
```

## 文档

- [添加 Agent 工具](docs/adding-tools.md)
- [HITL 后端要求](docs/hitl-backend.md)
- [M5 外部能力与媒体模板](docs/m5-external-capabilities.md)
- [M6 质量系统](docs/m6-quality-system.md)
- [后端一致性路线图](docs/backend-parity-roadmap.md)

## 许可证

本项目采用 [Cyanyi Drama 个人使用许可证 1.0](LICENSE)，是源代码可用许可证，不是 OSI 定义的开源许可证。自然人可用于个人非商业用途；公司或其他商业用途、客户项目、收费服务和 SaaS 均须事先取得版权所有者的书面商业授权。第三方依赖与素材遵循各自许可证。
