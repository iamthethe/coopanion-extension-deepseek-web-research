import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEEPSEEKSEARCH_DEFAULTS, DEEPSEEKSEARCH_SECRET, type DeepseeksearchConfigSection } from './config.ts';
import { DEEPSEEKSEARCH_TOOL_DECLS, DeepseeksearchWorld } from './world.ts';

export const DEEPSEEKSEARCH: WorldDefinition<DeepseeksearchConfigSection> = {
  id: 'deepseeksearch',
  label: 'DeepSeek 网页搜索',
  defaults: () => ({ ...DEEPSEEKSEARCH_DEFAULTS }),
  create: (ctx) => new DeepseeksearchWorld({
    cfg: ctx.cfg, timezone: ctx.timezone,
    secret: () => ctx.secret(DEEPSEEKSEARCH_SECRET),
    saveKey: (value) => {
      const suffix = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.bak`;
      // 用户主动保存时备份现有凭证；旧配置清理必须在 .env 写入成功之后。
      for (const name of ['.env', ...(ctx.cfg.apiKey ? ['config.json'] : [])]) {
        const file = join(ctx.botDir, name);
        if (existsSync(file)) copyFileSync(file, `${file}.${suffix}`, 1);
      }
      ctx.storeSecret(DEEPSEEKSEARCH_SECRET, value);
      if (ctx.cfg.apiKey) ctx.persist({ apiKey: '' });
    },
  }),
  describe: {
    tools: describeTools(DEEPSEEKSEARCH_TOOL_DECLS, {
      deepseeksearch_search: { zh: '通过 DeepSeek 搜索公开网页，返回带来源的摘要。', en: 'Search public webpages through DeepSeek and return sourced summaries.' },
      deepseeksearch_fetch: { zh: '通过 DeepSeek 抓取网页 Markdown，支持分页续读。', en: 'Fetch webpage Markdown through DeepSeek with paged reading.' },
    }),
    events: [{ type: 'deepseeksearch.started', description: { zh: 'World 已挂载，不代表远端认证成功；只归档。', en: 'World mounted; remote authentication is unverified. Archive only.' } }],
  },
};
