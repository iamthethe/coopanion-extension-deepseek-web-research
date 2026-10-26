/** 手动在线验收：只读指定部署配置，不输出密钥、不写查询结果到磁盘。 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DeepseeksearchWorld } from '../src/world.ts';
import { DEEPSEEKSEARCH_DEFAULTS, DEEPSEEKSEARCH_SECRET } from '../src/config.ts';
const [kind, value, configPath] = process.argv.slice(2);
if (!['search', 'fetch'].includes(kind) || !value || !configPath) {
  console.error('Usage: node --import tsx scripts/smoke.mjs search <query> <deployment-config.json> | fetch <public-url> <deployment-config.json>');
  process.exitCode = 1;
} else {
  let cfg;
  try {
    cfg = { ...DEEPSEEKSEARCH_DEFAULTS, ...JSON.parse(readFileSync(configPath, 'utf8')).worlds?.deepseeksearch };
  } catch {
    console.error('无法读取部署配置，请检查文件路径和 JSON 格式。');
    process.exit(1);
  }
  const envFile = join(dirname(configPath), '.env');
  const secret = () => process.env[DEEPSEEKSEARCH_SECRET] || (existsSync(envFile)
    ? new RegExp(`^[ \\t]*${DEEPSEEKSEARCH_SECRET}[ \\t]*=[ \\t]*(\\S+)`, 'm').exec(readFileSync(envFile, 'utf8'))?.[1] ?? '' : '');
  const world = new DeepseeksearchWorld({ cfg, timezone: 'UTC', secret,
    saveKey: () => { throw new Error('诊断脚本只读。'); } });
  const tool = world.tools().find((item) => item.name === `deepseeksearch_${kind}`);
  try {
    const result = await tool.handler(kind === 'search' ? { query: value } : { url: value }, {});
    console.log(typeof result === 'string' ? result : result.text);
    if (typeof result !== 'string' && result.failed) process.exitCode = 1;
  } finally { await world.stop(); }
}
