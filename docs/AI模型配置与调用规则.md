# AI 模型配置与调用规则

## 环境变量

仅在部署环境或本地 `.env` 配置，禁止提交真实密钥到仓库：

- `KIMI_API_KEY`、`KIMI_BASE_URL`、`KIMI_MODEL`
- `ZHIPU_API_KEY`、`ZHIPU_BASE_URL`、`ZHIPU_MODEL`
- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`
- 兜底模型仍可使用 `QWEN_API_KEY` / `AI_API_KEY`

## 路由规则（后端自动）

- 长文本总结、知识整理、指南读书笔记：优先 `Kimi`
- 中文医学问答、自然语言查询解释：优先 `智谱`
- 异常原因分析、复杂推理、质控推理：优先 `DeepSeek`
- 若目标模型未配置密钥，自动回退默认模型（`QWEN_MODEL` / `AI_MODEL`）

## 医学问答边界

- 支持医学相关问题与流程解释
- 不输出身份证、手机号等敏感信息
- 仅作为辅助建议，最终决策由执业医师完成

## 患者问题提问范式

涉及本科室患者数据时，建议使用以下范式：

`请分析患者ID/姓名在近3个月 Kt/V、血红蛋白、血钾和超滤量的趋势，指出异常依据、可能原因和复查建议。`

后端会基于当前账号授权范围装配 evidence，且不向模型传输身份证号、手机号等 PII 字段。
