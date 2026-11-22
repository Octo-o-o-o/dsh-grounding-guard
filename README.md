# dsh-grounding-guard

[English](./README.en.md)

面向 DeepSeek Harness (`dsh@0.2.2-rc.5`) 的**确定性证据校验与反幻觉护栏插件**（数据源解耦，零运行时依赖）。

## 核心能力

- **开放证据总线 (`ctx.governanceEvidence`)**：不绑死任何特定知识库或数据库。自动被动捕获内置读文件 / 搜索 / Web 工具的输出与截断标志（`truncated` / `nextOffset`），同时允许 `dsh-local-kb`、数据查询插件或业务插件主动注册结构化证据。
- **Stage 1 确定性零成本校验（默认开启）**：
  - **伪造引用检测**：拦截 `[ev:id]` / `[claim:id]` / `[source:id]` 中不存在于本会话证据总线的引用。
  - **反向引文定位（Reverse Quote Locator）**：对引用句中的直接引文做原文精确定位 / 空白归一匹配，定位不到即判失败。
  - **截断读全称断言拦截**：当工具或知识库读取返回 `truncated: true` 且存在未读 `nextOffset` 时，阻止模型直接宣称“全文未找到 / 文件中没有 / 全量合计为 N”。
  - **Structured `answerBlocks` v2 校验渲染**：严格校验结构化问数结果块（`fact`/`table`/`metadata`/`choice`/`notice`），禁止模型在自由文本中自填数值或伪造行号。
  - **宿主机物证校验 (`verifyArtifact`)**：使用 `lstat` + `realpath` + `O_NOFOLLOW` + 前后 `fstat` 竞态检查与 SHA-256 / RFC-4180 CSV 列和校验，不轻信执行器自述。
  - **记忆绝对化措辞护栏 (`absoluteWordingGuard`)**：拦截未豁免（非引号原话、非否定式）的“总是 / 从不 / 一定 / always / never / expert”过度概括写入记忆。
  - **写入回执收敛 (`WriteReceipt`)**：在 `tools/post-execute` 将写文件类工具输出收敛为仅含路径、字节数、状态与 SHA-256 的紧凑回执（`contentKind: 'receipt'`），去除原始正文回流以降低上下文污染与幻觉。
- **有界自纠与持久化诚实结论**：在 `agent/turn-stopping` 钩子中执行校验；命中阻断问题时最多调用 `1` 次 `agent.steer(UserMessage)` 要求模型纠偏（绝不死循环），并将最终 `verified` / `partial` / `unverified` / `contradicted` 以 `ignorable: true` 插件事件（`plugin:dsh-grounding-guard/evidence-verdict`）持久化到会话日志。
- **Stage 2 独立 NLI 复核（默认关闭，按需开启）**：通过 `ctx.llm` 使用独立 purpose `'grounding-verify'`，将待验句与引文装入不可信 JSON 数据边界；发生超时、格式错误或模型不可用时一律 **fail-closed 降级为 `unverified`**。

## 安装

```bash
dsh plugin --profile web add github:Octo-o-o-o/dsh-grounding-guard
dsh web
```

## 诚实边界说明

- **降低并显式暴露幻觉，而非宣称“零幻觉”**：确定性校验可拦截伪造引用、引文篡改、截断误判与自填数值，但无法验证未被引用、未落工具证据的开放常识陈述。
- **Stage 2 NLI 依赖独立模型可用性**：开启 NLI 复核会增加每轮延迟与 Token 消耗；超时或报错时严格降级为 `unverified`，绝不乐观放行。

## 许可协议

[Apache-2.0](./LICENSE) — Copyright 2026 OctoLab (`Octo-o-o-o`).
