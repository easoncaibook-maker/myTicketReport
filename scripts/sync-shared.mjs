import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 该环境不支持稳定的 workspace 软链接，这里把构建产物复制到各应用的 node_modules 下。
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = join(root, 'packages', 'shared');
const targets = [
  join(root, 'apps', 'api', 'node_modules', '@ticketreport', 'shared'),
  join(root, 'apps', 'web', 'node_modules', '@ticketreport', 'shared'),
];

if (!existsSync(join(source, 'dist', 'index.js'))) {
  console.error('请先构建 shared 包');
  process.exit(1);
}

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(join(source, 'package.json'), join(target, 'package.json'));
  cpSync(join(source, 'dist'), join(target, 'dist'), { recursive: true });
  console.log(`shared -> ${target}`);
}
