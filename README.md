# 运维工单系统（TicketReport）

面向多客户企业的内网工单系统：客户提交报障 → 运维认领/改派 → 处理 → 客户确认 → 关闭，全流程状态可追溯，客户企业之间严格数据隔离。

- 需求文档：[docs/requirements.md](docs/requirements.md)
- 实施计划：[docs/plan.md](docs/plan.md)

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite + Ant Design 5 + TanStack Query + React Router |
| 后端 | NestJS 10 + Prisma 6 + SQLite（预留 PostgreSQL） |
| 认证 | JWT Access（15 分钟，内存）+ Refresh（httpOnly Cookie，7 天轮换） |
| 邮件 | Nodemailer + 本地 Outbox 可靠队列（SMTP 未配置时只入库不发送） |
| 部署 | Docker Compose（Nginx + API），SQLite 与附件挂载到数据卷 |

## 本地开发

环境要求：Node.js ≥ 20（建议 22/24）、npm ≥ 10。Windows 请使用 PowerShell。

```powershell
# 1. 安装依赖
npm install

# 2. 生成 Prisma Client、建库并写入演示数据
npm run db:generate
npm run db:push
npm run seed

# 3. 同时启动 API(3000) 和 Web(5173)
npm run dev
```

也可以分别启动：

```powershell
npm run dev:api   # http://localhost:3000/api
npm run dev:web   # http://localhost:5173
```

首次启动前复制环境变量模板（仓库不提供真实 `.env`，请勿把本地 `.env` 提交到仓库）：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

`.env` 中的 JWT 密钥、SMTP 与管理员初始密码均为开发占位值，生产部署请全部替换。

### 演示账号

| 角色 | 邮箱 | 密码 | 说明 |
| --- | --- | --- | --- |
| 管理员 | admin@example.com | Admin123! | 系统管理、企业/账号/分类/设置 |
| 运维主管 | lead@example.com | Passw0rd! | 跨组查看、改派、强制关闭 |
| 处理人 | agent1@example.com | Passw0rd! | 基础运维组成员 |
| 处理人 | agent2@example.com | Passw0rd! | 应用支持组成员 |
| 客户员工 | alice@acme.com | Passw0rd! | 华东制造 |
| 客户员工 | bob@acme.com | Passw0rd! | 华东制造（同企业互见） |
| 客户员工 | carol@beichen.com | Passw0rd! | 北辰科技（数据隔离验证） |

> 生产环境请立即修改管理员密码，并重新生成 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建 shared + API + Web |
| `npm run typecheck` | 三端类型检查 |
| `npm test` | 运行后端单元测试（状态机、密码、数据范围） |
| `npm run db:push` | 按 SQLite schema 同步数据库结构 |
| `npm run seed` | 写入演示数据（已有管理员时自动跳过） |
| `npm run seed:base` | 空库初始化：仅写入管理员、分类、处理组和系统设置，不含演示数据 |

### 已有数据库升级

结构变更新增的字段都是可空列，直接执行 `npm run db:push`（PostgreSQL 用 `npm run db:push:pg`）即可平滑升级，已有数据保留、无需重建库。例如「处理工时」字段 `Ticket.workHours` 升级后历史工单为空值，可由处理人在工单详情中补填。

## Docker 一键部署

```powershell
# 在项目根目录
$env:JWT_ACCESS_SECRET="请替换为随机长字符串"
$env:JWT_REFRESH_SECRET="请替换为另一个随机长字符串"
$env:SEED_DEMO="true"      # 首次部署写入演示数据，生产可设为 false
docker compose up -d --build
```

访问 `http://服务器IP:8080`。Nginx 托管前端静态资源，并把 `/api` 反向代理到 API 容器。

- 数据卷：`ticket-data`，包含 SQLite 文件 `/data/dev.db` 与附件 `/data/uploads`，容器重建不丢数据。
- 健康检查：`GET /api/health`。
- 修改端口：设置环境变量 `WEB_PORT`（默认 8080）。

### 邮件配置

通过环境变量提供，未配置时邮件只写入本地 outbox（状态 `SKIPPED_NO_SMTP`），不影响业务：

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@example.com
SMTP_PASSWORD=******
SMTP_FROM=运维工单 <no-reply@example.com>
```

管理员可在「系统设置」查看 SMTP 是否已配置，以及最近 50 封 outbox 邮件。发送失败会按 1/5/15 分钟退避重试，最多 3 次。

邀请/重置密码链接基于 `APP_BASE_URL` 生成，部署后请设置为实际访问地址（如 `http://192.168.1.10:8080`）。

### 备份与恢复

```powershell
# 备份数据卷到本地
docker run --rm -v ticketreport_ticket-data:/data -v ${PWD}:/backup alpine `
  tar czf /backup/ticketreport-backup.tar.gz -C /data .

# 恢复（先停止 api 容器）
docker compose stop api
docker run --rm -v ticketreport_ticket-data:/data -v ${PWD}:/backup alpine `
  sh -c "rm -rf /data/* && tar xzf /backup/ticketreport-backup.tar.gz -C /data"
docker compose start api
```

## 切换到 PostgreSQL（预留）

仓库提供两份结构一致的 Prisma schema：

- `apps/api/prisma/schema.sqlite.prisma`
- `apps/api/prisma/schema.postgresql.prisma`

切换步骤：

1. 准备 PostgreSQL，并设置 `DATABASE_URL=postgresql://user:pass@host:5432/ticketreport?schema=public`；
2. `npm run db:generate:pg`（在 `apps/api` 下）重新生成客户端；
3. `npm run db:push:pg` 建表；
4. 重启 API。

> 当前 Compose 默认只跑 SQLite。需要 PostgreSQL 时可自行在 compose 中增加 `postgres` 服务并调整 `DATABASE_URL`。

## 角色与核心流程

| 角色 | 能力 |
| --- | --- |
| 提报人 REPORTER | 提交工单、查看本企业全部工单、公开评论、确认/反馈/重开本人工单、待受理撤回 |
| 处理人 AGENT | 认领本组工单、处理、内部备注、转派、提交处理结果 |
| 运维主管 OPS_LEAD | 处理人权限 + 跨组查看、改派、撤回认领、强制关闭 |
| 管理员 ADMIN | 全部数据 + 企业/账号/分类/处理组/系统设置/审计 |

状态机：`待受理 → 处理中 → 待提报人确认 → 已关闭`，另有终态 `已取消`（提报人待受理阶段撤回）。非法流转由后端统一拒绝并返回明确错误。

数据隔离：客户侧所有查询强制附加 `enterpriseId`；跨企业资源统一返回 404；附件下载、评论、通知同样受边界约束。后端测试覆盖了数据范围规则。

## 目录结构

```text
TicketReport/
├─ apps/
│  ├─ api/                  # NestJS API、Prisma schema、种子数据、单元测试
│  └─ web/                  # React SPA
├─ packages/shared/         # 角色/状态/优先级枚举、状态机、标签
├─ scripts/sync-shared.mjs  # 将 shared 构建产物同步到各应用
├─ docker/                  # Dockerfile、Nginx 配置、启动脚本
├─ docker-compose.yml
└─ docs/                    # 需求文档、实施计划
```

## 常见问题

**1. `Cannot find module '@ticketreport/shared'`**

部分受限环境不支持 npm workspaces 软链接。执行 `npm run build:shared`，脚本会把构建产物复制到 `apps/*/node_modules/@ticketreport/shared`。安装依赖后若再次报错，重新执行该命令即可。

**2. 邮件没有真实发出**

检查 `SMTP_*` 环境变量是否配置。未配置属于预期行为：邮件写入 outbox 并标记 `SKIPPED_NO_SMTP`，可在「系统设置 → 邮件 Outbox」查看内容与状态。

**3. 客户看到 404 而不是 403**

这是刻意的安全设计：避免通过状态码探测其他企业资源是否存在。

**4. 工单无法重开**

重开受系统设置「工单重开时限」限制（默认 7 天），超期请新建工单。
