# DSH Postmortem / DSH 事后复盘

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的本地优先、只读失败复盘插件。

Local-first, read-only failure postmortems for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-postmortem` 从既有 DSH session event log 生成简短、脱敏的故障报告。它不会改变 agent loop、重试工具、注入提示词或上传完整轨迹。可选模型复盘始终是第二层：确定性规则结论优先，模型输出无效或不可用时会被丢弃。

`dsh-postmortem` turns the existing DSH session event log into a short, redacted incident report. It does not alter the agent loop, retry a tool, inject a prompt, or upload a transcript. Optional model review is deliberately a second layer: deterministic findings are authoritative, and invalid or unavailable model output is discarded.

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

When `model.enabled` is true, the plugin sends at most four already-redacted findings to the configured DSH model with a 240-token cap and configured timeout. The response must be exactly this JSON shape:

```json
{
  "summary": "...",
  "immediateAction": "...",
  "evidenceSteps": [1],
  "confidence": "low"
}
```

每个接受的 `evidenceSteps` 都必须对应一条已记录 finding。任何网络错误、超时、非 JSON、额外字段、缺失字段、未知步骤或非法字段都会将 `modelState` 置为 `failed`，但确定性报告仍可使用。模型复盘只负责解释，不控制重试或工具执行。

Every accepted `evidenceSteps` item must identify a recorded finding. Any transport error, timeout, non-JSON output, extra key, missing key, unknown step, or invalid field makes `modelState` `failed`; the deterministic report remains available. Model review is explanatory, not a controller for retry or tool execution.

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

仓库当前的验收范围更窄且可复现：12 条代表性 DSH 事件 fixture、3 条无本地 finding 的干净轨迹、严格的模型 JSON 验证或降级，以及一条真实 `SessionStore + CommandRuntime + LlmRuntime` 组合测试。这些验证插件行为正确，但不虚构未测量的任务成功率结论。

Current repository acceptance checks are intentionally narrower and reproducible: 12 representative DSH event fixtures, three clean traces with no local finding, strict model-JSON validation or fallback, and one real `SessionStore + CommandRuntime + LlmRuntime` composition test. They establish correct plugin behavior, not an unmeasured task-success claim.

## 评测数据来源 / Evaluation Data Sources

本包不内置外部任务语料，也不会下载语料。12 条 synthetic event fixture 维护在 [`test/fixtures.ts`](test/fixtures.ts)，模拟 DSH 的公开 session event 词汇表。任何外部配对评测在比较结果前，都必须在实验报告中记录数据集来源、版本或 commit hash、许可证或条款、获取日期、任务子集和成功判定器。

The package ships no external task corpus and makes no corpus download. Its 12 synthetic event fixtures are maintained in [`test/fixtures.ts`](test/fixtures.ts) and model DSH's public session event vocabulary. Any external paired evaluation must add its dataset source, version or commit hash, license/terms, acquisition date, task subset, and success oracle to its experiment report before results are compared.

## 开发 / Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

本包目标版本为 DSH `0.1.0-rc.6` 和 Cordis `4.0.1`。DSH 仍处于 developer preview；插件以公开 session event 词汇表作为兼容性边界。

The package targets DSH `0.1.0-rc.6` and Cordis `4.0.1`. DSH is in developer preview; the public session event vocabulary is this plugin's compatibility boundary.

## 许可证 / License

[MIT](LICENSE)
