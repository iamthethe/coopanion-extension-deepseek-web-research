import type { ConfigGroup } from 'cortico/core/types.ts';

export interface DeepseeksearchConfigSection {
  enabled: boolean;
  apiKey?: string;
  timeoutMs: number;
  count: number;
  maxContentChars: number;
}

export const DEEPSEEKSEARCH_DEFAULTS: DeepseeksearchConfigSection = {
  enabled: false,
  apiKey: '',
  timeoutMs: 30000,
  count: 5,
  maxContentChars: 16000,
};

export const DEEPSEEKSEARCH_CONFIG_GROUP: ConfigGroup = {
  id: 'world:deepseeksearch',
  owner: 'world:deepseeksearch',
  schema: {
    type: 'object',
    title: 'DeepSeek 网页搜索',
    properties: {
      'worlds.deepseeksearch.apiKey': {
        type: 'string', title: 'DeepSeek API Key',
        description: '直接填写 DeepSeek 密钥，明文保存在部署 config.json 中；保存后下次请求生效。不读取 .env。',
      },
      'worlds.deepseeksearch.timeoutMs': {
        type: 'integer', title: '请求超时（毫秒）', minimum: 1000, maximum: 120000,
      },
      'worlds.deepseeksearch.count': {
        type: 'integer', title: '默认搜索条数', minimum: 1, maximum: 50,
      },
      'worlds.deepseeksearch.maxContentChars': {
        type: 'integer', title: '正文每页字符数', minimum: 1000, maximum: 50000,
        description: '抓取支持 offset 续读；搜索正文按每条上限裁剪，回执会标明。',
      },
    },
  },
};
