# 验证记录

## 0.2.0 — 2026-10-26 检索配置与密钥面板

- 新增最多条数、返回精细度、摘要最长字符、默认正文开关与重试次数；原有默认检索行为保留。密钥从普通配置迁回宿主secret/storeSecret；新面板只返回固定打码状态及旧字段是否存在，不返回完整密钥。
- package.json和src/config.ts修改前备份.20261026-settings.bak。用户主动保存／迁移密钥时，相关部署文件先留带时间和UUID的备份，写入.env成功后才清空旧配置字段；备份可能仍含旧密钥。构造和干装载不迁移、不写密钥。
- pnpm typecheck、pnpm typecheck:web、pnpm test --maxWorkers 1 --minWorkers 1通过，32项测试。覆盖默认／显式条数上限、各精细度、Unicode摘要裁剪、正文默认与覆盖、旧密钥不隐式使用、迁移备份顺序／失败保留、打码和热改、503后成功／429耗尽／401及402不重试／取消重试等待。
- JSDOM面板检查验证真实前端面板＋后端数据面：密码输入、固定打码、空输入不覆盖、保存清空、完整密钥不回传、失败保留草稿、迁移确认、卸载清空；全部通过，无新增依赖。
- 原版describe脚本重新导出；测试宿主Coopanion0.2.11/API6 manifest、干装载、自描述一致性检查通过，零警告失败，面板资产存在。pnpm pack --dry-run确认包含webui/client.js且不含备份/测试scratch；诊断脚本语法和diff检查通过。
- 完整官方checker仍受下述既有minecraft-data缺失限制，本轮不重复安装或绕过检查。没有安装到运行实例、读取真实密钥、修改部署或进行付费API调用。真实页面及联网行为待用户更新重启后目击。

## 0.1.1 配置密钥

- 按用户明确要求覆盖原先的 .env 方案：新增 worlds.deepseeksearch.apiKey，默认空；明文保存于部署 config.json，下一次请求现读，不回落到 .env 或进程环境。
- package.json、src/config.ts 修改前保留 .20261025-config-key.bak。未读取真实密钥、未修改运行实例。
- 类型检查、23项测试通过；新增保存后搜索/抓取使用新密钥、WebUI状态与回执不回显密钥、旧配置不读取宿主secret的验证。
- 原版describe重新生成；Coopanion0.2.10/API6干装载及自描述一致性通过，零警告失败；独立诊断脚本语法通过，改为只读显式指定的部署config.json。
- 完整官方checker仍受下述既有minecraft-data缺失限制；本轮没有重复依赖安装。真实API和第三级行为未验证。

## 0.1.0 初次验证

- 开发环境：Node 24.22.1、pnpm 11.25.0、Git 2.53；corepack未在PATH中，使用现有pnpm。扩展开发依赖离线安装成功，无运行时依赖。
- 第一级通过：pnpm typecheck；pnpm test --maxWorkers 1 --minWorkers 1，21项通过。
- Cortico e3b214e原版extension-describe.ts导出describe.json成功（2工具、1事件、1提示词）；通过已有framework-dependencies.mjs解析已下载依赖，没有修改检查脚本。
- 测试宿主Coopanion 0.2.10 / World API 6：公开parseExtensionManifest、dryMountWorld、exportDescribe检查通过，零警告、零失败，自描述与包内JSON一致。复现命令见README。
- 完整官方checker未通过：标准pnpm命令触发框架缺依赖的自动安装，网络无进展后已停止；再直接运行未修改的extension-check.ts，仍在导入内置Minecraft时缺minecraft-data。未修改检查器、未跳过内置World、未继续反复安装。
- 离线测试覆盖：无密钥、不唤醒的挂载事件、真实请求体和来源回执、Unicode查询限制、空结果、非法URL/输入、正文分页/裁剪、HTTP401/402/403/404/429/500脱敏与不重试、错误JSON/结构、取消/停止、超时、8MiB响应上限。
- 独立smoke脚本无密钥运行给出缺密钥失败（退出1，预期行为），未向DeepSeek发请求。
- 第三级未完成：未安装或修改运行实例、未读真实密钥、未执行真实付费调用。需要用户本地安装，确认卡片、挂载事件、两个工具回执及自然语言请求时的优先选择。

完整第二级与第三级通过前，不宣称扩展已完成全部验收。
