// 构建 Windows 体验版运行目录 build/win/app（内置 Node 运行时 + 依赖 + 演示数据）
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, 'build', 'win', 'app');
const NM = path.join(STAGE, 'node_modules');
const VERSION = '0.2.0';

const RUNTIME_DEPS = [
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/core',
  '@nestjs/jwt',
  '@nestjs/platform-express',
  '@prisma/client',
  'cookie-parser',
  'dotenv',
  'multer',
  'nodemailer',
  'reflect-metadata',
  'rxjs',
  'sanitize-html',
  'zod',
];

const CRLF = (s) => s.replace(/\r?\n/g, '\r\n');
// 批处理必须用 CRLF 且仅含 ASCII，否则中文 Windows 下 cmd.exe 会解析错行
const writeCmd = (file, content) => writeFileSync(path.join(STAGE, file), CRLF(content));
// PowerShell 5.1 需要 BOM 才能按 UTF-8 读取中文
const writePs = (file, content) => writeFileSync(path.join(STAGE, file), '\uFEFF' + CRLF(content));
const writeText = (file, content) => writeFileSync(path.join(STAGE, file), '\uFEFF' + CRLF(content));

function copy(src, dest) {
  if (!existsSync(src)) throw new Error(`缺少文件/目录: ${src}`);
  cpSync(src, dest, { recursive: true, dereference: true });
}

// 在 workspace 各处 node_modules 中查找包目录
function findPackageDir(name) {
  const candidates = [
    path.join(ROOT, 'node_modules', name),
    path.join(ROOT, 'apps', 'api', 'node_modules', name),
    path.join(ROOT, 'apps', 'web', 'node_modules', name),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return null;
}

function collectClosure(roots) {
  const found = new Map();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.shift();
    if (found.has(name)) continue;
    const dir = findPackageDir(name);
    if (!dir) {
      console.warn(`[warn] 未找到依赖包: ${name}`);
      continue;
    }
    found.set(name, dir);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pkg.dependencies || {})) queue.push(dep);
    for (const dep of Object.keys(pkg.optionalDependencies || {})) {
      if (findPackageDir(dep)) queue.push(dep);
    }
  }
  return found;
}

console.log('[1/7] 清理输出目录');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

console.log('[2/7] 复制 Node 运行时');
const nodeExe = process.execPath;
cpSync(nodeExe, path.join(STAGE, 'node.exe'));
console.log(`      node.exe <- ${nodeExe}`);

console.log('[3/7] 复制应用产物');
copy(path.join(ROOT, 'apps', 'api', 'dist'), path.join(STAGE, 'app'));
copy(path.join(ROOT, 'apps', 'web', 'dist'), path.join(STAGE, 'public'));
mkdirSync(path.join(STAGE, 'prisma'), { recursive: true });
cpSync(
  path.join(ROOT, 'apps', 'api', 'prisma', 'schema.sqlite.prisma'),
  path.join(STAGE, 'prisma', 'schema.sqlite.prisma'),
);
mkdirSync(path.join(STAGE, 'data'), { recursive: true });
// demo.db 为内置演示数据（首次启动复制为 app.db）；base.db 为空库模板（切换空库用）
copy(path.join(ROOT, 'build', 'win', 'data', 'demo.db'), path.join(STAGE, 'data', 'demo.db'));
copy(path.join(ROOT, 'build', 'win', 'data', 'base.db'), path.join(STAGE, 'data', 'base.db'));
copy(path.join(ROOT, 'build', 'win', 'app.ico'), path.join(STAGE, 'app.ico'));
copy(path.join(ROOT, 'docs', '操作手册.md'), path.join(STAGE, '操作手册.md'));

console.log('[4/7] 复制运行时依赖');
const packages = collectClosure(RUNTIME_DEPS);
mkdirSync(NM, { recursive: true });
let count = 0;
for (const [name, dir] of packages) {
  const dest = path.join(NM, name);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(dir, dest, { recursive: true, dereference: true });
  count += 1;
}
console.log(`      共 ${count} 个依赖包`);

// Prisma 生成的客户端（含 Windows 查询引擎）
const prismaGenerated = path.join(ROOT, 'node_modules', '.prisma', 'client');
if (!existsSync(prismaGenerated)) throw new Error('缺少 Prisma 生成客户端，请先执行 npm run db:generate');
copy(prismaGenerated, path.join(NM, '.prisma', 'client'));

// 共享包
const sharedPkgDir = path.join(NM, '@ticketreport', 'shared');
mkdirSync(sharedPkgDir, { recursive: true });
cpSync(path.join(ROOT, 'packages', 'shared', 'dist'), path.join(sharedPkgDir, 'dist'), {
  recursive: true,
  dereference: true,
});
cpSync(path.join(ROOT, 'packages', 'shared', 'package.json'), path.join(sharedPkgDir, 'package.json'));

console.log('[5/7] 写入启动脚本与配置模板');
writeFileSync(
  path.join(STAGE, 'package.json'),
  JSON.stringify({ name: 'ticketreport-runtime', version: VERSION, private: true }, null, 2),
);

writeCmd(
  'start.cmd',
  String.raw`@echo off
setlocal
set "APP_DIR=%~dp0"
if not defined DATA_DIR set "DATA_DIR=%LOCALAPPDATA%\TicketReport"
if not exist "%DATA_DIR%\data" mkdir "%DATA_DIR%\data"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"
if not exist "%DATA_DIR%\uploads" mkdir "%DATA_DIR%\uploads"
rem first run: copy built-in demo database
if not exist "%DATA_DIR%\data\app.db" copy /Y "%APP_DIR%data\demo.db" "%DATA_DIR%\data\app.db" >nul

set "PORT=3210"
set "HOST=127.0.0.1"
set "DATABASE_URL=file:%DATA_DIR:\=/%/data/app.db"
set "UPLOAD_DIR=%DATA_DIR%\uploads"
set "WEB_DIST_DIR=%APP_DIR%public"
set "NODE_ENV=production"
set "ACCESS_TOKEN_TTL=900s"
set "REFRESH_TOKEN_TTL_DAYS=7"
set "APP_BASE_URL=http://127.0.0.1:3210"
set "JWT_ACCESS_SECRET=ticketreport-demo-access-secret-2026"
set "JWT_REFRESH_SECRET=ticketreport-demo-refresh-secret-2026"
set "SMTP_HOST="
set "SMTP_PORT="
set "SMTP_SECURE="
set "SMTP_USER="
set "SMTP_PASSWORD="
set "SMTP_FROM="
set "INITIAL_ADMIN_EMAIL=admin@example.com"
set "INITIAL_ADMIN_PASSWORD=Admin123!"

rem user config: %LOCALAPPDATA%\TicketReport\config.env (KEY=VALUE, # comment)
if exist "%DATA_DIR%\config.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%DATA_DIR%\config.env") do (
    if not "%%~a"=="" set "%%~a=%%~b"
  )
)

rem upgrade legacy database (idempotent, auto backup before changes)
"%APP_DIR%node.exe" "%APP_DIR%migrate.cjs" >> "%DATA_DIR%\logs\migrate.log" 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%start.ps1"
endlocal
`,
);

writePs(
  'start.ps1',
  String.raw`$ErrorActionPreference = 'SilentlyContinue'
$port = if ($env:PORT) { $env:PORT } else { '3210' }
$bindHost = if ($env:HOST) { $env:HOST } else { '127.0.0.1' }
$base = 'http://' + $bindHost + ':' + $port
$health = $base + '/api/health'

function Test-AppAlive {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

$alive = Test-AppAlive
if (-not $alive) {
  $appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $dataDir = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'TicketReport' }
  $logDir = Join-Path $dataDir 'logs'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Start-Process -FilePath (Join-Path $appDir 'node.exe') -ArgumentList @((Join-Path $appDir 'app\main.js')) -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.out.log') -RedirectStandardError (Join-Path $logDir 'server.err.log')
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-AppAlive) { $alive = $true; break }
  }
}

Start-Sleep -Milliseconds 200
Start-Process $base
`,
);

writeCmd(
  'launcher.vbs',
  String.raw`Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
ws.Run "cmd /c """ & base & "\start.cmd""", 0, False
`,
);

writeCmd(
  'stop.cmd',
  String.raw`@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-service.ps1"
`,
);

writePs(
  'stop-service.ps1',
  String.raw`param([switch]$Quiet)
$ErrorActionPreference = 'SilentlyContinue'
$dataDir = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'TicketReport' }
$port = 3210
$config = Join-Path $dataDir 'config.env'
if (Test-Path $config) {
  foreach ($line in Get-Content $config) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $kv = $line -split '=', 2
    if ($kv[0].Trim() -eq 'PORT') { $port = [int]$kv[1].Trim() }
  }
}
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $conns.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  Write-Host ('已停止服务（端口 ' + $port + '）')
} else {
  Write-Host ('服务未在运行（端口 ' + $port + '）')
}
if (-not $Quiet) {
  Write-Host ''
  Read-Host '按回车键关闭' | Out-Null
}
`,
);

writeCmd(
  'switch-to-base.cmd',
  String.raw`@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0switch-to-base.ps1"
`,
);

writePs(
  'switch-to-base.ps1',
  String.raw`$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot
$dataDir = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'TicketReport' }
Write-Host '此操作会把当前数据库替换为空白初始库（仅保留管理员、分类与处理组）。'
Write-Host '当前数据库会先备份到 data 目录（app.db.bak-时间戳）。'
Write-Host '已上传的附件不会自动删除，如需彻底清空请手动删除 uploads 目录。'
$confirm = Read-Host '输入 YES 继续'
if ($confirm -ne 'YES') {
  Write-Host '已取消'
  Read-Host '按回车键关闭' | Out-Null
  exit
}
& (Join-Path $appDir 'stop-service.ps1') -Quiet
$dataSub = Join-Path $dataDir 'data'
New-Item -ItemType Directory -Force -Path $dataSub | Out-Null
$db = Join-Path $dataSub 'app.db'
if (Test-Path $db) {
  $backup = Join-Path $dataSub ('app.db.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Copy-Item $db $backup -Force
  Write-Host ('已备份原数据库到 ' + $backup)
}
Copy-Item (Join-Path $appDir 'data\base.db') $db -Force
Write-Host '已切换为空库，双击桌面图标重新启动即可（管理员 admin@example.com / Admin123!）。'
Read-Host '按回车键关闭' | Out-Null
`,
);

// 旧版本数据库增量升级：User/Ticket 新增字段、Ticket.enterpriseId 可空、收藏与关联表
writeFileSync(
  path.join(STAGE, 'migrate.cjs'),
  String.raw`/**
 * 数据库增量升级（幂等）。首次发生变更前自动备份为 app.db.bak-时间戳。
 * 覆盖 0.1.0 旧包升级到当前版本所需的结构差异。
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function resolveDbPath(raw) {
  if (!raw) return null;
  let p = raw;
  if (p.startsWith('file:')) p = p.slice(5);
  p = p.replace(/^\/([A-Za-z]:)/, '$1');
  try { p = decodeURIComponent(p); } catch (e) {}
  return p;
}

const dbPath = resolveDbPath(process.env.DATABASE_URL);
if (!dbPath || !fs.existsSync(dbPath)) {
  console.log('[migrate] 未找到数据库，跳过（首次启动会复制演示库）');
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
const hasTable = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const tableInfo = (name) => (hasTable(name) ? db.prepare('PRAGMA table_info("' + name + '")').all() : []);
const colNames = (name) => tableInfo(name).map((c) => c.name);

const userCols = colNames('User');
const ticketInfo = tableInfo('Ticket');
const ticketCols = ticketInfo.map((c) => c.name);
const enterpriseCol = ticketInfo.find((c) => c.name === 'enterpriseId');

const needUser = ['mustChangePassword', 'passwordChangedAt', 'tokenVersion', 'totpSecret', 'totpEnabledAt', 'totpRecoveryCodes', 'totpLastStep'].filter((c) => !userCols.includes(c));
const needTicketCols = ['ticketType', 'onBehalf', 'closeSource', 'workHours'].filter((c) => !ticketCols.includes(c));
const needRebuild = ticketCols.length > 0 && (needTicketCols.length > 0 || (enterpriseCol && enterpriseCol.notnull === 1));
const needTables = !hasTable('TicketFavorite') || !hasTable('TicketRelation') || !hasTable('LoginChallenge') || !hasTable('TrustedDevice');

if (!needUser.length && !needRebuild && !needTables) {
  console.log('[migrate] 数据库结构已是最新');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backup = dbPath + '.bak-' + stamp;
fs.copyFileSync(dbPath, backup);
console.log('[migrate] 已备份数据库到 ' + path.basename(backup));

if (needUser.length) {
  db.exec('PRAGMA foreign_keys=OFF');
  if (needUser.includes('mustChangePassword')) db.exec('ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false');
  if (needUser.includes('passwordChangedAt')) db.exec('ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME');
  if (needUser.includes('tokenVersion')) db.exec('ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0');
  if (needUser.includes('totpSecret')) db.exec('ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT');
  if (needUser.includes('totpEnabledAt')) db.exec('ALTER TABLE "User" ADD COLUMN "totpEnabledAt" DATETIME');
  if (needUser.includes('totpRecoveryCodes')) db.exec('ALTER TABLE "User" ADD COLUMN "totpRecoveryCodes" TEXT');
  if (needUser.includes('totpLastStep')) db.exec('ALTER TABLE "User" ADD COLUMN "totpLastStep" INTEGER');
  db.exec('PRAGMA foreign_keys=ON');
  console.log('[migrate] 已补齐 User 字段: ' + needUser.join(', '));
}

if (needRebuild) {
  const newCols = ['id', 'ticketNo', 'ticketType', 'enterpriseId', 'onBehalf', 'reporterId', 'title', 'description',
    'categoryId', 'priority', 'status', 'groupId', 'assigneeId', 'resolution', 'resolvedAt', 'confirmedAt',
    'closedAt', 'closedById', 'closeReason', 'closeSource', 'cancelledAt', 'cancelReason', 'workHours',
    'reopenCount', 'version', 'lastActivityAt', 'createdAt', 'updatedAt'];
  const common = newCols.filter((c) => ticketCols.includes(c));
  const list = common.map((c) => '"' + c + '"').join(', ');
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN');
  try {
    db.exec('CREATE TABLE "Ticket_new" (' +
      '"id" TEXT NOT NULL PRIMARY KEY, ' +
      '"ticketNo" TEXT NOT NULL, ' +
      '"ticketType" TEXT NOT NULL DEFAULT \'CUSTOMER\', ' +
      '"enterpriseId" TEXT, ' +
      '"onBehalf" BOOLEAN NOT NULL DEFAULT false, ' +
      '"reporterId" TEXT NOT NULL, ' +
      '"title" TEXT NOT NULL, ' +
      '"description" TEXT NOT NULL, ' +
      '"categoryId" TEXT NOT NULL, ' +
      '"priority" TEXT NOT NULL DEFAULT \'P3\', ' +
      '"status" TEXT NOT NULL DEFAULT \'PENDING\', ' +
      '"groupId" TEXT NOT NULL, ' +
      '"assigneeId" TEXT, ' +
      '"resolution" TEXT, ' +
      '"resolvedAt" DATETIME, ' +
      '"confirmedAt" DATETIME, ' +
      '"closedAt" DATETIME, ' +
      '"closedById" TEXT, ' +
      '"closeReason" TEXT, ' +
      '"closeSource" TEXT, ' +
      '"cancelledAt" DATETIME, ' +
      '"cancelReason" TEXT, ' +
      '"workHours" REAL, ' +
      '"reopenCount" INTEGER NOT NULL DEFAULT 0, ' +
      '"version" INTEGER NOT NULL DEFAULT 0, ' +
      '"lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      '"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      '"updatedAt" DATETIME NOT NULL, ' +
      'CONSTRAINT "Ticket_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE SET NULL ON UPDATE CASCADE, ' +
      'CONSTRAINT "Ticket_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, ' +
      'CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE, ' +
      'CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, ' +
      'CONSTRAINT "Ticket_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OpsGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE' +
      ')');
    db.exec('INSERT INTO "Ticket_new" (' + list + ') SELECT ' + list + ' FROM "Ticket"');
    db.exec('DROP TABLE "Ticket"');
    db.exec('ALTER TABLE "Ticket_new" RENAME TO "Ticket"');
    db.exec('CREATE UNIQUE INDEX "Ticket_ticketNo_key" ON "Ticket"("ticketNo")');
    db.exec('CREATE INDEX "Ticket_ticketNo_idx" ON "Ticket"("ticketNo")');
    db.exec('CREATE INDEX "Ticket_enterpriseId_status_lastActivityAt_idx" ON "Ticket"("enterpriseId", "status", "lastActivityAt")');
    db.exec('CREATE INDEX "Ticket_groupId_status_idx" ON "Ticket"("groupId", "status")');
    db.exec('CREATE INDEX "Ticket_assigneeId_status_idx" ON "Ticket"("assigneeId", "status")');
    db.exec('COMMIT');
    console.log('[migrate] 已重建 Ticket 表并补齐字段: ' + (needTicketCols.join(', ') || 'enterpriseId 可空'));
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys=ON');
    console.error('[migrate] Ticket 表升级失败，原库未改动，备份：' + backup);
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  }
  db.exec('PRAGMA foreign_keys=ON');
}

if (!hasTable('TicketFavorite')) {
  db.exec('CREATE TABLE "TicketFavorite" (' +
    '"id" TEXT NOT NULL PRIMARY KEY, ' +
    '"ticketId" TEXT NOT NULL, ' +
    '"userId" TEXT NOT NULL, ' +
    '"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
    'CONSTRAINT "TicketFavorite_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, ' +
    'CONSTRAINT "TicketFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE' +
    ')');
  db.exec('CREATE UNIQUE INDEX "TicketFavorite_ticketId_userId_key" ON "TicketFavorite"("ticketId", "userId")');
  db.exec('CREATE INDEX "TicketFavorite_userId_createdAt_idx" ON "TicketFavorite"("userId", "createdAt")');
  console.log('[migrate] 已创建 TicketFavorite 表');
}

if (!hasTable('TicketRelation')) {
  db.exec('CREATE TABLE "TicketRelation" (' +
    '"id" TEXT NOT NULL PRIMARY KEY, ' +
    '"ticketId" TEXT NOT NULL, ' +
    '"relatedTicketId" TEXT NOT NULL, ' +
    '"createdById" TEXT NOT NULL, ' +
    '"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
    'CONSTRAINT "TicketRelation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, ' +
    'CONSTRAINT "TicketRelation_relatedTicketId_fkey" FOREIGN KEY ("relatedTicketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE' +
    ')');
  db.exec('CREATE UNIQUE INDEX "TicketRelation_ticketId_relatedTicketId_key" ON "TicketRelation"("ticketId", "relatedTicketId")');
  db.exec('CREATE INDEX "TicketRelation_relatedTicketId_idx" ON "TicketRelation"("relatedTicketId")');
  console.log('[migrate] 已创建 TicketRelation 表');
}

if (!hasTable('LoginChallenge')) {
  db.exec('CREATE TABLE "LoginChallenge" (' +
    '"id" TEXT NOT NULL PRIMARY KEY, ' +
    '"userId" TEXT NOT NULL, ' +
    '"mode" TEXT NOT NULL, ' +
    '"tokenHash" TEXT NOT NULL, ' +
    '"secret" TEXT, ' +
    '"attempts" INTEGER NOT NULL DEFAULT 0, ' +
    '"maxAttempts" INTEGER NOT NULL DEFAULT 5, ' +
    '"sendCount" INTEGER NOT NULL DEFAULT 0, ' +
    '"lastSentAt" DATETIME, ' +
    '"expiresAt" DATETIME NOT NULL, ' +
    '"consumedAt" DATETIME, ' +
    '"ip" TEXT, ' +
    '"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
    'CONSTRAINT "LoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE' +
    ')');
  db.exec('CREATE UNIQUE INDEX "LoginChallenge_tokenHash_key" ON "LoginChallenge"("tokenHash")');
  db.exec('CREATE INDEX "LoginChallenge_userId_mode_idx" ON "LoginChallenge"("userId", "mode")');
  db.exec('CREATE INDEX "LoginChallenge_expiresAt_idx" ON "LoginChallenge"("expiresAt")');
  console.log('[migrate] 已创建 LoginChallenge 表');
}

if (!hasTable('TrustedDevice')) {
  db.exec('CREATE TABLE "TrustedDevice" (' +
    '"id" TEXT NOT NULL PRIMARY KEY, ' +
    '"userId" TEXT NOT NULL, ' +
    '"tokenHash" TEXT NOT NULL, ' +
    '"userAgent" TEXT, ' +
    '"ip" TEXT, ' +
    '"lastUsedAt" DATETIME, ' +
    '"expiresAt" DATETIME NOT NULL, ' +
    '"revokedAt" DATETIME, ' +
    '"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
    'CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE' +
    ')');
  db.exec('CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash")');
  db.exec('CREATE INDEX "TrustedDevice_userId_expiresAt_idx" ON "TrustedDevice"("userId", "expiresAt")');
  console.log('[migrate] 已创建 TrustedDevice 表');
}

const check = db.prepare('PRAGMA integrity_check').get();
console.log('[migrate] 升级完成，integrity_check=' + check.integrity_check);
`,
);

writeFileSync(
  path.join(STAGE, 'config.env.sample'),
  CRLF(
    [
      '# Copy this file to %LOCALAPPDATA%\\TicketReport\\config.env and edit as needed.',
      '# Format: KEY=VALUE (no spaces around =, no quotes around the value)',
      '',
      '# Change the port when 3210 is occupied',
      '#PORT=3210',
      '#HOST=127.0.0.1',
      '',
      '# SMTP mail (without it mails are only written to the local outbox)',
      '#SMTP_HOST=smtp.exmail.qq.com',
      '#SMTP_PORT=465',
      '#SMTP_SECURE=true',
      '#SMTP_USER=no-reply@your-domain.com',
      '#SMTP_PASSWORD=your-password',
      '#SMTP_FROM=Ops Ticket <no-reply@your-domain.com>',
      '',
    ].join('\n'),
  ),
);

writeText(
  '使用说明.txt',
  [
    '运维工单系统（内测版 ' + VERSION + '）',
    '',
    '启动：双击桌面或开始菜单中的「运维工单系统」图标，稍等几秒会自动打开浏览器。',
    '访问地址：http://127.0.0.1:3210',
    '详细操作请查看「开始菜单 → 运维工单系统 操作手册」，或安装目录下的 操作手册.md。',
    '',
    '内置演示数据（首次启动自动载入）：',
    '  管理员      admin@example.com   / Admin123!',
    '  运维主管    lead@example.com    / Passw0rd!',
    '  处理人      agent1@example.com  / Passw0rd!（基础运维组）',
    '              agent2@example.com  / Passw0rd!（应用支持组）',
    '  客户员工    alice@acme.com      / Passw0rd!（华东制造）',
    '              bob@acme.com        / Passw0rd!（华东制造）',
    '              carol@beichen.com   / Passw0rd!（北辰科技）',
    '',
    '数据目录：%LOCALAPPDATA%\\TicketReport（数据库 data\\app.db，附件 uploads\\，日志 logs\\）',
    '重置数据：关闭程序后删除 %LOCALAPPDATA%\\TicketReport\\data\\app.db，重新启动会再次载入演示库。',
    '切换空库：双击开始菜单「运维工单系统 切换空库」，或安装目录下的 switch-to-base.cmd。',
    '停止服务：双击开始菜单「运维工单系统 停止服务」，或安装目录下的 stop.cmd。',
    'SMTP 配置：参考安装目录下的 config.env.sample。',
    '卸载：Windows 设置 → 应用 → 运维工单系统 → 卸载（卸载不会删除数据目录）。',
  ].join('\n'),
);

console.log('[6/7] 复制操作手册');
console.log('      操作手册.md');

console.log('[7/7] 统计');
let bytes = 0;
(function rec(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) rec(p);
    else bytes += st.size;
  }
})(STAGE);
console.log(`      staging 大小: ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${STAGE}`);
