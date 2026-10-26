import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { DEEPSEEKSEARCH_DEFAULTS, type DeepseeksearchConfigSection } from './config.ts';
import { DEEPSEEKSEARCH_TOOL_DECLS, DeepseeksearchWorld } from './world.ts';

export const DEEPSEEKSEARCH: WorldDefinition<DeepseeksearchConfigSection> = {
  id: 'deepseeksearch',
  label: 'DeepSeek 网页搜索',
  defaults: () => ({ ...DEEPSEEKSEARCH_DEFAULTS }),
  create: (ctx) => new DeepseeksearchWorld({
    cfg: ctx.cfg, timezone: ctx.timezone,
  }),
  describe: {
    tools: describeTools(DEEPSEEKSEARCH_TOOL_DECLS, {
      deepseeksearch_search: { zh: '通过 DeepSeek 搜索公开网页，返回带来源的摘要。', en: 'Search public webpages through DeepSeek and return sourced summaries.' },
      deepseeksearch_fetch: { zh: '通过 DeepSeek 抓取网页 Markdown，支持分页续读。', en: 'Fetch webpage Markdown through DeepSeek with paged reading.' },
    }),
    events: [{ type: 'deepseeksearch.started', description: { zh: 'World 已挂载，不代表远端认证成功；只归档。', en: 'World mounted; remote authentication is unverified. Archive only.' } }],
  },
};
