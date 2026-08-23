# DSH Postmortem / DSH 事后复盘

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的本地优先、只读失败复盘插件。

Local-first, read-only failure postmortems for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-postmortem` 从既有 DSH session event log 生成简短、脱敏的故障报告。它不会改变 agent loop、重试工具、注入提示词或上传完整轨迹。可选模型复盘始终是第二层：确定性规则结论优先，模型输出无效或不可用时会被丢弃。

`dsh-postmortem` turns the existing DSH session event log into a short, redacted incident report. It does not alter the agent loop, retry a tool, inject a prompt, or upload a transcript. Optional model review is deliberately a second layer: deterministic findings are authoritative, and invalid or unavailable model output is discarded.

## Evidence-First Postmortems / 证据优先的复盘

无需模型即可工作：对 DSH session event 进行本地、只读分析，定位失败工具、遗漏结果、未变更重试、终止原因和用户主动取消。报告只保留可审计的事件序号、步骤、工具名、错误码和不透明调用 ID。

Works without a model: local, read-only analysis of DSH session events identifies failed tools, missing results, unchanged retries, terminal causes, and explicit user cancellation. Reports retain only auditable event sequences, steps, tool names, error codes, and opaque call IDs.

| 已验证能力 / Verified capability | 为什么重要 / Why it matters |
| --- | --- |
| 零模型主链 / Zero-model core | 不依赖 API，模型不可用时仍有确定性、可解释的报告。 / Deterministic and explainable even when no API is configured. |
| 参数指纹 / Argument fingerprints | 用规范化 SHA-256 判断未变更重试；原始参数不进入 trace、缓存、报告或模型提示。 / Detects equivalent retries without retaining raw arguments. |
| 取消不是故障 / Cancellation-aware | 用户取消不会被误报为待修复失败；非用户中断仍有证据化报告。 / A user cancellation is not misreported as a repairable failure. |
| 可比较模型层 / Comparable model layer | 严格 JSON、10 秒默认超时、单 trace 请求合并、并发评测和安全失败类别。 / Strict JSON, a 10 s default timeout, trace-level request coalescing, bounded parallel evaluation, and safe failure categories. |

## 安装 / Install

```sh
npm install @huichangzz/dsh-postmortem
```

在 DSH profile 的 `cordis.patch.yml` 中加入：

Add this to the DSH profile's `cordis.patch.yml`:

```yaml
- id: postmortem
  name: '@huichangzz/dsh-postmortem'
  config:
    autoOnFailure: true
    model:
      enabled: false
      provider: your-provider
      model: your-model
      timeoutMs: 10000
```

插件使用 DSH 已配置的 `llm` 服务。请在 DSH 中配置模型 provider 和密钥；本包没有 API key 配置，也不会写入密钥。

The plugin uses DSH's existing `llm` service. Configure model providers and keys in DSH, rather than this plugin; the package has no API-key setting and never writes a key.

## 命令 / Commands

| 命令 / Command | 结果 / Result |
| --- | --- |
| `/postmortem [turn]` | 查看最近或指定轮次的可读报告。 / Readable report for the latest or selected turn. |
| `/postmortem-export [turn]` | 导出脱敏的 schema-v2 JSON 报告。 / Redacted schema-v2 JSON report. |
| `/postmortem-repair [turn]` | 为已检测失败生成仅可复制的修复提示。 / Copy-only repair prompt for a detected failure. |

命令使用 `recordInput: false`，因此轮次选择不会写入 `command/run` 事件。修复命令只返回文本：不会调用工具、提交 follow-up、重试操作，或成为模型上下文。

Commands use `recordInput: false`, so turn selection is not copied into `command/run` events. The repair command returns text only: it never calls a tool, submits a follow-up, retries an action, or makes itself model context.

## 检测与隐私边界 / Detection And Privacy Boundary

本地规则检测工具错误结果、已结束轮次中缺失的工具结果、三次及以上未变更的失败重试，以及非 `completed` 的轮次结束。仍在执行的轮次会保持 `inconclusive`，不会仅因结果尚未到达就被误判为失败。

The local rules detect tool error results, absent results after a closed turn, unchanged failed retries (three or more), and non-completed turn endings. An open turn stays `inconclusive`; it is not treated as a failed call simply because its result has not arrived yet.

报告仅保留轮次号、工具名、不透明 call ID、错误码、步骤和 DSH 事件序号。报告不会保留或导出用户消息、工具参数、工具输出、文件内容、提示词、凭据或原始 session trace。内存缓存中也只有这些脱敏报告，DSH 退出后即消失。

Reports retain only turn number, tool name, opaque call ID, error code, step, and DSH event sequence numbers. They do not retain or export user messages, tool arguments, tool output, file contents, prompts, credentials, or a raw session trace. The in-memory cache contains those redacted reports only and disappears when DSH exits.

当 `model.enabled` 为 true 时，插件最多向配置的 DSH 模型发送四条已脱敏 finding，输出上限为 240 token，并使用配置的超时。模型必须严格返回以下 JSON：

When `model.enabled` is true, the plugin sends at most four already-redacted findings to the configured DSH model with a 240-token cap and a 10-second default timeout (override with `timeoutMs`). Concurrent requests for the same session, turn, and event sequence share one review. The response must be exactly this JSON shape:

```json
{
  "findingCode": "tool_error",
  "summary": "...",
  "immediateAction": "...",
  "evidenceSteps": [1],
  "confidence": "low",
  "actionability": "actionable"
}
```

每个接受的 `evidenceSteps` 都必须对应一条已记录 finding。任何网络错误、超时、非 JSON、额外字段、缺失字段、未知步骤或非法字段都会将 `modelState` 置为 `failed`，但确定性报告仍可使用。模型复盘只负责解释，不控制重试或工具执行。

Every accepted `evidenceSteps` item must identify a recorded finding. Any transport error, timeout, non-JSON output, extra key, missing key, unknown step, or invalid field makes `modelState` `failed`; the deterministic report remains available. Model review is explanatory, not a controller for retry or tool execution.

模型只可选择已存在的 `findingCode`，并标注建议的可执行性；它不能引入新的根因、步骤或工具调用。默认超时、格式失败和网络失败都回退到本地报告。

The model can select only an existing `findingCode` and classify the actionability of its suggestion; it cannot introduce a new cause, step, or tool call. Timeout, format, and transport failures all fall back to the local report.

## 如何衡量提升 / Measuring Improvement

本包可以证明诊断行为正确，但无法单独诚实地证明最终任务成功率提升，因为 runner、任务语料、模型和停止规则都在插件外部。

This package proves diagnostic behavior locally. It cannot honestly prove end-task success-rate uplift on its own because the runner, task corpus, model, and stop rule live outside the plugin.

外部 runner 可使用 `PairedRunRecord` 和 `evaluatePairs()` 做配对实验。发布的 JSON Schema 位于 [`schemas/paired-run-v1.schema.json`](schemas/paired-run-v1.schema.json)。每个任务必须有一条匹配的 `baseline` 和一条 `postmortem` 记录，且 `taskId` 与 `taskFingerprint` 相同；`evaluatePairs()` 会排除不完整或不匹配的 pair，而不会静默比较。

Use `PairedRunRecord` and `evaluatePairs()` for an external runner's paired experiment. The published JSON Schema is [`schemas/paired-run-v1.schema.json`](schemas/paired-run-v1.schema.json). For every task, run exactly one matched `baseline` attempt and one `postmortem` attempt with the same task ID and `taskFingerprint`; `evaluatePairs()` excludes incomplete or mismatched pairs rather than silently comparing them.

任务成功率提升的发布门槛：

Release gates for a task-success claim:

1. 运行前登记任务来源、版本或 hash、模型 route、工具集、重试预算、超时和成功判定器。 / Pre-register the task source, task version/hash, model route, tool set, retry budget, timeout, and success oracle before running.
2. 收集至少 100 个有效匹配 pair；修正组只能使用 copy-only prompt 流程，不能启用自动重试。 / Collect at least 100 eligible matched pairs. Keep the correction arm to the copy-only prompt workflow; do not enable automatic retries.
3. 报告 baseline/postmortem 成功率、差值、paired wins/losses/ties、排除原因、工具调用数与耗时。 / Report baseline success rate, postmortem success rate, success-rate delta, paired wins/losses/ties, excluded-pair reasons, tool-call count, and elapsed time.
4. 仅当 postmortem 成功率至少提升 5 个百分点、paired wins 多于 losses，且安全检查、工具调用数和耗时没有实质退化时，才宣称有提升；否则结论为无定论或负向。 / Claim an improvement only when postmortem success rises by at least 5 percentage points, paired wins exceed paired losses, and no material regression in safety checks, tool-call count, or elapsed time is observed. Otherwise report the result as inconclusive or negative.

仓库当前的验收范围更窄且可复现：24 条可追溯的 DSH seed corpus 记录、13 条 schema 级事件 fixture、严格的模型 JSON 验证或降级，以及一条真实 `SessionStore + CommandRuntime + LlmRuntime` 组合测试。这些验证插件行为正确，但不虚构未测量的任务成功率结论。

Current repository acceptance checks are intentionally narrower and reproducible: 24 traceable DSH seed-corpus records, 13 schema-level event fixtures, strict model-JSON validation or fallback, and one real `SessionStore + CommandRuntime + LlmRuntime` composition test. They establish correct plugin behavior, not an unmeasured task-success claim.

## Evaluation Loop / 评测闭环

当前版本内置 24 条版本化 seed 记录，其中 15 条从最新 DSH `dsh-v0.1.1-rc.2` 的公开 snapshot 或测试 fixture 脱敏派生，9 条由公开 session schema 构造。每条记录使用稳定的 SHA-256 record-id 分区：20% 为 holdout，新增记录不会移动既有记录。

The current package includes 24 versioned seed records: 15 redacted records derived from public snapshots or test fixtures in the latest DSH `dsh-v0.1.1-rc.2`, plus nine records constructed from the public session schema. A stable SHA-256 record-id partition assigns 20% to holdout, and adding records never moves an existing one.

人工 benchmark 只接受两位匿名审阅者完全一致的标签，或带有两名 reviewer ID 的裁决结果。使用 [`diagnosis-annotation-v1`](schemas/diagnosis-annotation-v1.schema.json) 提交审阅，用 [`diagnosis-adjudication-v1`](schemas/diagnosis-adjudication-v1.schema.json) 解决分歧；聚合器会把其他记录明确标记为未解决。

A human benchmark accepts only exact agreement from two pseudonymous reviewers, or an adjudication carrying both reviewer IDs. Submit reviews with [`diagnosis-annotation-v1`](schemas/diagnosis-annotation-v1.schema.json) and resolve disagreement with [`diagnosis-adjudication-v1`](schemas/diagnosis-adjudication-v1.schema.json); the aggregator explicitly leaves every other record unresolved.

四模型协议 smoke test 使用任意 OpenAI-compatible endpoint，并只发送脱敏 finding。结果落在被 Git 忽略的 `artifacts/`，且只记录合法结构化结果、延迟和安全失败类别，不保存密钥或无效原始回复：

The four-model protocol smoke test works with any OpenAI-compatible endpoint and sends only redacted findings. Results go to Git-ignored `artifacts/` and retain only accepted structured reviews, latency, and safe failure categories, never keys or invalid raw responses:

```sh
POSTMORTEM_EVAL_BASE_URL=https://api.example.com/v1 \
POSTMORTEM_EVAL_API_KEY=your-key \
POSTMORTEM_EVAL_MODELS=model-a,model-b,model-c,model-d \
POSTMORTEM_EVAL_SPLIT=development \
POSTMORTEM_EVAL_CONCURRENCY=2 \
npm run eval:models
```

该命令默认先对每个模型运行单样本预检；仅将通过预检的模型加入其余样本的全局并发 2 批次。任务按样本轮转模型，首个 429 会打开熔断并把其余项目标为 `skipped`，不会继续消耗共享额度。全局并发 2 是共享限流环境的保守起点，应在实际 endpoint 上逐步提高；它是 seed 协议/吞吐 smoke test，不是模型质量或任务成功率结论。只有 human holdout 的双审/裁决参考标签才能用于比较 finding、证据和 actionability 的准确率。

This command preflights every model on one sample by default, then includes only passing models in a global-concurrency-2 batch for the remaining samples. Work round-robins models by case; the first 429 opens a circuit and marks remaining work `skipped` rather than spending more shared quota. Global concurrency 2 is a conservative starting point for shared rate limits and should be raised gradually on the actual endpoint. It is a seed protocol-and-throughput smoke test, not a model-quality or task-success claim. Only double-reviewed or adjudicated human holdout references may compare finding, evidence, and actionability accuracy.

## 评测数据来源 / Evaluation Data Sources

本包包含一个小型、公开可追溯且脱敏的 seed corpus：[`datasets/dsh-public-v0.1.1-rc.2`](datasets/dsh-public-v0.1.1-rc.2)。它包含 15 条从 DeepSeek Harness `dsh-v0.1.1-rc.2` 公开 snapshot 或测试 fixture 派生的记录，以及 9 条依据公开 DSH session event 词汇表构造的记录。每条记录包含来源路径、revision、MIT 许可证和获取日期；完整的脱敏与标签限制见 [`datasets/README.md`](datasets/README.md)。13 条 schema 级 synthetic fixture 仍维护在 [`test/fixtures.ts`](test/fixtures.ts)。

该 corpus 的 `seed` 标签仅由显式事件事实整理，用于防止 parser 和规则回归，不能作为 precision、recall、模型质量或最终任务成功率的独立结论。升级为人工质量 benchmark 前，必须由两名独立审阅者使用 [`diagnosis-annotation-v1`](schemas/diagnosis-annotation-v1.schema.json) 标注主要问题、证据步骤和可行动性，并裁决分歧。任何外部配对评测在比较结果前，都必须在实验报告中记录数据集来源、版本或 commit hash、许可证或条款、获取日期、任务子集和成功判定器。

The package includes one small, public, traceable, redacted seed corpus: [`datasets/dsh-public-v0.1.1-rc.2`](datasets/dsh-public-v0.1.1-rc.2). It contains 15 records derived from public DeepSeek Harness `dsh-v0.1.1-rc.2` snapshots or test fixtures and nine records constructed from the public DSH session-event vocabulary. Every record carries its source path, revision, MIT license, and acquisition date; see [`datasets/README.md`](datasets/README.md) for the complete redaction and label policy. The 13 schema-level synthetic fixtures remain in [`test/fixtures.ts`](test/fixtures.ts).

The corpus's `seed` labels are curated only from explicit event facts, so they protect parser and rule regressions but cannot independently support claims about precision, recall, model quality, or end-task success. Before promotion to a human-quality benchmark, two independent reviewers must use [`diagnosis-annotation-v1`](schemas/diagnosis-annotation-v1.schema.json) to label the primary issue, evidence steps, and actionability, then adjudicate disagreements. Any external paired evaluation must add its dataset source, version or commit hash, license/terms, acquisition date, task subset, and success oracle to its experiment report before results are compared.

## 开发 / Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

本包目标版本为 DSH `0.1.1-rc.2` 和 Cordis `4.0.1`。DSH 仍处于 developer preview；插件以公开 session event 词汇表作为兼容性边界。

The package targets DSH `0.1.1-rc.2` and Cordis `4.0.1`. DSH is in developer preview; the public session event vocabulary is this plugin's compatibility boundary.

## 许可证 / License

[MIT](LICENSE)
