// 构建 Windows 体验版运行目录 build/win/app（内置 Node 运行时 + 依赖 + 演示数据）
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, 'build', 'win', 'app');
const NM = path.join(STAGE, 'node_modules');

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
  'zod',
];

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

console.log('[1/6] 清理输出目录');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

console.log('[2/6] 复制 Node 运行时');
const nodeExe = process.execPath;
cpSync(nodeExe, path.join(STAGE, 'node.exe'));
console.log(`      node.exe <- ${nodeExe}`);

console.log('[3/6] 复制应用产物');
copy(path.join(ROOT, 'apps', 'api', 'dist'), path.join(STAGE, 'app'));
copy(path.join(ROOT, 'apps', 'web', 'dist'), path.join(STAGE, 'public'));
mkdirSync(path.join(STAGE, 'prisma'), { recursive: true });
cpSync(
  path.join(ROOT, 'apps', 'api', 'prisma', 'schema.sqlite.prisma'),
  path.join(STAGE, 'prisma', 'schema.sqlite.prisma'),
);
mkdirSync(path.join(STAGE, 'data'), { recursive: true });
copy(path.join(ROOT, 'build', 'win', 'data', 'base.db'), path.join(STAGE, 'data', 'base.db'));
copy(path.join(ROOT, 'build', 'win', 'app.ico'), path.join(STAGE, 'app.ico'));

console.log('[4/6] 复制运行时依赖');
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

console.log('[5/6] 写入启动脚本');
writeFileSync(
  path.join(STAGE, 'package.json'),
  JSON.stringify({ name: 'ticketreport-runtime', version: '0.1.0', private: true }, null, 2),
);

writeFileSync(
  path.join(STAGE, 'start.cmd'),
  String.raw`@echo off
setlocal
set "APP_DIR=%~dp0"
set "DATA_DIR=%LOCALAPPDATA%\TicketReport"
if not exist "%DATA_DIR%\data" mkdir "%DATA_DIR%\data"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"
if not exist "%DATA_DIR%\uploads" mkdir "%DATA_DIR%\uploads"
if not exist "%DATA_DIR%\data\app.db" copy /Y "%APP_DIR%data\base.db" "%DATA_DIR%\data\app.db" >nul

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
set "INITIAL_ADMIN_EMAIL=admin@example.com"
set "INITIAL_ADMIN_PASSWORD=Admin123!"
set "APP_DIR"

powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%start.ps1"
endlocal
`,
);

writeFileSync(
  path.join(STAGE, 'start.ps1'),
  String.raw`$ErrorActionPreference = 'SilentlyContinue'
$base = 'http://127.0.0.1:3210'
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
  $logDir = Join-Path $env:LOCALAPPDATA 'TicketReport\logs'
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

writeFileSync(
  path.join(STAGE, 'launcher.vbs'),
  String.raw`Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
ws.Run "cmd /c """ & base & "\start.cmd""", 0, False
`,
);

writeFileSync(
  path.join(STAGE, '使用说明.txt'),
  [
    '运维工单系统',
    '',
    '启动：双击桌面或开始菜单中的「运维工单系统」图标，稍等几秒会自动打开浏览器。',
    '访问地址：http://127.0.0.1:3210',
    '',
    '初始数据：仅包含管理员账号、3 个工单分类和 2 个处理组，不含演示企业、账号和工单。',
    '  管理员      admin@example.com / Admin123!',
    '',
    '重置数据：关闭程序后删除 %LOCALAPPDATA%\\TicketReport\\data\\app.db 及 uploads 目录，再次启动会重新生成初始模板。',
    '数据目录：%LOCALAPPDATA%\\TicketReport（数据库 data\\app.db，附件 uploads\\，日志 logs\\）',
    '卸载：Windows 设置 → 应用 → 运维工单系统 → 卸载（卸载不会删除上述数据目录）',
  ].join('\r\n'),
);

console.log('[6/6] 统计');
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
