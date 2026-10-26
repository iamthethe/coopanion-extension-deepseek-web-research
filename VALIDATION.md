# 2026-10-25 验证记录

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
- 本机Coopanion 0.2.10 / World API 6：公开parseExtensionManifest、dryMountWorld、exportDescribe检查通过，零警告、零失败，自描述与包内JSON一致。复现命令见README。
- 完整官方checker未通过：标准pnpm命令触发框架缺依赖的自动安装，网络无进展后已停止；再直接运行未修改的extension-check.ts，仍在导入内置Minecraft时缺minecraft-data。未修改检查器、未跳过内置World、未继续反复安装。
- 离线测试覆盖：无密钥、不唤醒的挂载事件、真实请求体和来源回执、Unicode查询限制、空结果、非法URL/输入、正文分页/裁剪、HTTP401/402/403/404/429/500脱敏与不重试、错误JSON/结构、取消/停止、超时、8MiB响应上限。
- 独立smoke脚本无密钥运行给出缺密钥失败（退出1，预期行为），未向DeepSeek发请求。
- 第三级未完成：未安装或修改运行实例、未读真实密钥、未执行真实付费调用。需要用户本地安装，确认卡片、挂载事件、两个工具回执及自然语言请求时的优先选择。

完整第二级与第三级通过前，不宣称扩展已完成全部验收。
