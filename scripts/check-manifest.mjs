#!/usr/bin/env node
/**
 * 权限守卫：直接检查构建产物的 manifest，而不是源码。
 *
 * 这是唯一一条改源码绕不过去的红线检查 —— 无论谁（人还是 AI）
 * 通过什么方式（wxt.config、entrypoint 选项、hooks）引入了广泛权限，
 * 都会在这里被拦住。红线的理由见 docs/decisions/0002-permission-model.md。
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = ['chrome-mv3', 'firefox-mv2', 'edge-mv3'];

/** 只允许这几个权限；新增权限必须先更新 ADR-0002 与商店权限说明。 */
const ALLOWED_PERMISSIONS = new Set(['storage', 'activeTab', 'scripting', 'contextMenus']);

/** 允许出现在 host 权限里的域名，必须与 src/engines/ids.ts 保持一致。 */
const ALLOWED_HOSTS = new Set([
  'https://www.bing.com/*',
  'https://translate.google.com/*',
  'https://fanyi-api.baidu.com/*',
]);

/** 广泛权限的各种写法，出现在非 optional 字段里就是违规。 */
const BROAD_PATTERNS = [/^<all_urls>$/, /^\*:\/\/\*\/\*$/, /^https?:\/\/\*\/\*$/, /^\*:\/\/\*$/];

const isBroad = (value) => BROAD_PATTERNS.some((pattern) => pattern.test(value));

function checkManifest(target, manifest) {
  const errors = [];

  // 1) 不允许静态声明内容脚本：注入必须走 activeTab / 用户授权的动态注册
  if (manifest.content_scripts?.length) {
    errors.push(
      `存在静态 content_scripts（${manifest.content_scripts.length} 条）。` +
        `内容脚本必须用 registration: 'runtime' 且不写 matches。`,
    );
  }

  // 2) MV2 把 host 权限合并进 permissions，需要分开判断
  const permissions = manifest.permissions ?? [];
  const hostPermissions = manifest.host_permissions ?? permissions.filter((item) => item.includes('://'));
  const apiPermissions = permissions.filter((item) => !item.includes('://'));

  for (const permission of apiPermissions) {
    if (!ALLOWED_PERMISSIONS.has(permission)) {
      errors.push(`未登记的权限 "${permission}"。新增权限请先更新 docs/decisions/0002-permission-model.md。`);
    }
  }

  for (const host of hostPermissions) {
    if (isBroad(host)) {
      errors.push(`host 权限里出现广泛匹配 "${host}"。全站权限只能放在 optional 权限中。`);
    } else if (!ALLOWED_HOSTS.has(host)) {
      errors.push(`未登记的 host 权限 "${host}"。请同步 src/engines/ids.ts 与本脚本的白名单。`);
    }
  }

  // 3) 全站权限必须是可选的，且确实存在（自动翻译依赖它）
  const optional = manifest.optional_host_permissions ?? manifest.optional_permissions ?? [];
  if (!optional.some(isBroad)) {
    errors.push('缺少可选的全站权限，自动翻译功能将无法申请授权。');
  }

  // 4) 远程代码：MV3 政策禁止执行远程逻辑
  if (manifest.content_security_policy?.extension_pages?.includes('unsafe-eval')) {
    errors.push('CSP 中出现 unsafe-eval，会被商店以「远程代码执行」为由拒绝。');
  }

  return errors;
}

let failed = false;

for (const target of TARGETS) {
  const path = join('.output', target, 'manifest.json');
  if (!existsSync(path)) {
    console.error(`✗ ${target}: 找不到 ${path}，请先运行 npm run build:all`);
    failed = true;
    continue;
  }

  const manifest = JSON.parse(await readFile(path, 'utf-8'));
  const errors = checkManifest(target, manifest);

  if (errors.length === 0) {
    const hosts = (manifest.host_permissions ?? []).length || '合并进 permissions';
    console.log(`✓ ${target}: 权限检查通过（无 content_scripts，host 权限 ${hosts}）`);
  } else {
    failed = true;
    console.error(`✗ ${target}:`);
    for (const error of errors) console.error(`    - ${error}`);
  }
}

if (failed) {
  console.error('\n权限守卫失败。红线说明见 docs/decisions/0002-permission-model.md');
  process.exit(1);
}
