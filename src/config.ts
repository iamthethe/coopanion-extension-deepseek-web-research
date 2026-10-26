import type { ConfigGroup } from 'cortico/core/types.ts';

export const DEEPSEEKSEARCH_SECRET = 'CORTICO_DEEPSEEK_API_KEY';

export interface DeepseeksearchConfigSection {
  enabled: boolean;
  /** 旧版明文配置，只供用户主动迁移，不用于请求。 */
  apiKey?: string;
  timeoutMs: number;
  count: number;
  maxContentChars: number;
  maxCount?: number;
  resultDetail?: 'brief' | 'summary' | 'full';
  maxTextChars?: number;
  includeContent?: boolean;
  retries?: number;
}

export const DEEPSEEKSEARCH_DEFAULTS: DeepseeksearchConfigSection = {
  enabled: false,
  timeoutMs: 30000,
  count: 5,
  maxContentChars: 16000,
  maxCount: 50,
  resultDetail: 'full',
  maxTextChars: 0,
  includeContent: false,
  retries: 0,
};

export const DEEPSEEKSEARCH_CONFIG_GROUP: ConfigGroup = {
  id: 'world:deepseeksearch',
  owner: 'world:deepseeksearch',
  schema: {
    type: 'object',
    title: 'DeepSeek 网页搜索',
    properties: {
      'worlds.deepseeksearch.timeoutMs': {
        type: 'integer', title: '请求超时（毫秒）', minimum: 1000, maximum: 120000,
      },
      'worlds.deepseeksearch.count': {
        type: 'integer', title: '默认搜索条数', minimum: 1, maximum: 50,
        description: '未指定条数时使用；超过最多条数时按上限执行。',
      },
      'worlds.deepseeksearch.maxCount': {
        type: 'integer', title: '最多搜索条数', minimum: 1, maximum: 50,
        description: '模型指定的条数同样受此上限约束。',
      },
      'worlds.deepseeksearch.resultDetail': {
        type: 'string', title: '返回内容精细度', enum: ['brief', 'summary', 'full'],
        description: 'brief：短摘要；summary：长摘要；full：短摘要、完整长摘要和评分等信息（当前默认）。不改写网页内容。',
      },
      'worlds.deepseeksearch.maxTextChars': {
        type: 'integer', title: '每条摘要最长字符数', minimum: 0, maximum: 100000,
        description: '分别限制短摘要和长摘要，0 表示不额外截断，保留当前默认；按 Unicode 字符计。',
      },
      'worlds.deepseeksearch.includeContent': {
        type: 'boolean', title: '搜索默认附带网页正文',
        description: '默认关闭；模型可通过 need_content 显式覆盖。正文仍受下方长度上限限制。',
      },
      'worlds.deepseeksearch.maxContentChars': {
        type: 'integer', title: '正文每条／每页最长字符数', minimum: 1000, maximum: 50000,
        description: '抓取支持 offset 续读；搜索正文按每条上限裁剪，回执会标明。',
      },
      'worlds.deepseeksearch.retries': {
        type: 'integer', title: '请求失败重试次数', minimum: 0, maximum: 5,
        description: '默认 0；网络错误、超时、HTTP 408/429/5xx 才重试。每次尝试均使用请求超时，等待期间可取消。',
      },
    },
  },
};
