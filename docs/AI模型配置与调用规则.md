# AI 模型配置与调用规则

## 环境变量

仅在部署环境或本地 `.env` 配置，禁止提交真实密钥到仓库：

- `KIMI_API_KEY`、`KIMI_BASE_URL`、`KIMI_MODEL`
- `ZHIPU_API_KEY`、`ZHIPU_BASE_URL`、`ZHIPU_MODEL`
- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`
- `DOUBAO_API_KEY`、`DOUBAO_BASE_URL`、`DOUBAO_MODEL`
- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`（也可用于其他 OpenAI 兼容网关）
- `AI_FALLBACK_PROVIDER`：目标模型未配置时的优先兜底，可选 `deepseek` / `zhipu` / `kimi` / `doubao` / `openai`
- 兜底模型仍可使用 `QWEN_API_KEY` / `AI_API_KEY`
- `AI_SITE_EXCERPT_ENABLED`：是否在 AI 检索阶段自动抓取已启用专业网站的公开摘要（默认 `true`）

## 路由规则（后端自动）

- 长文本总结、知识整理、指南读书笔记：优先 `Kimi`
- 中文医学问答、自然语言查询解释：优先 `智谱`
- 异常原因分析、复杂推理、质控推理：优先 `DeepSeek`
- 若目标模型未配置密钥，自动按 `AI_FALLBACK_PROVIDER` 回退；若仍未配置，会依次尝试 DeepSeek、智谱、Kimi、豆包、OpenAI 兼容模型；最后回退默认模型（`QWEN_MODEL` / `AI_MODEL`）

## 自然语言查询模式

后端会先做意图识别，不再只支持固定问法：

- `structured_query`：命中白名单模板（患者 Kt/V/URR/超滤趋势、超滤超标名单）
- `medical_qa`：通用医学问答（不要求患者）
- `patient_context_qa`：疑似患者相关，但未形成可安全结构化查询时，给出边界说明 + 通用建议
- `unsupported_sensitive`：患者标识不充分或匹配不安全，提示补充患者 ID / 完整姓名后再查

## 知识库入库规则

- 前端勾选“保存到本地知识库”后，后端不会直接保存 AI 回答。
- 后端先检索本地知识库片段，再由模型把已检索到的资料整理为 3-6 条摘要。
- 入库正文只保存整理后的摘要，并按正文 SHA-256 去重。
- 若本次没有命中资料片段，则不会入库，避免把无来源的模型生成内容写入知识库。

## 已配置网站调用规则

- `/ai/sites` 中启用的网站会在本地知识库命中不足时作为专业网站引用来源注入提示词。
- 当 `AI_SITE_EXCERPT_ENABLED=true` 时，AI 分析会自动尝试抓取已启用站点的公开摘要并参与回答（带来源名）。
- “开始获取资料”会访问已启用站点的指南页，抓取公开正文并整理入指南阅读中心与本地知识库。
- 若关闭 `AI_SITE_EXCERPT_ENABLED`，普通 AI 分析仅引用站点元数据，不抓取网页摘要。
- 回答中会展示“专业网站引用/网站公开摘要”来源，便于确认是否已使用已配置网站。

## 医学问答边界

- 支持医学相关问题与流程解释
- 不输出身份证、手机号等敏感信息
- 仅作为辅助建议，最终决策由执业医师完成

## 患者问题提问范式

涉及本科室患者数据时，建议使用以下范式：

`请分析患者ID/姓名在近3个月 Kt/V、血红蛋白、血钾和超滤量的趋势，指出异常依据、可能原因和复查建议。`

后端会基于当前账号授权范围装配 evidence，且不向模型传输身份证号、手机号等 PII 字段。
