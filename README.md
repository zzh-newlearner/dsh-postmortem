# DSH Postmortem / DSH 事后复盘

> Turn a failed DeepSeek Harness run into a redacted recovery plan in seconds. Local-first, read-only, and useful without a model.
>
> 在几秒内把失败的 DeepSeek Harness 运行转成脱敏的恢复计划。本地优先、只读，且无需模型即可使用。

`dsh-postmortem` reads the DSH session events you already have and answers the practical question after a failed run: **what failed, what evidence supports it, and what should be checked before the next attempt?**

`dsh-postmortem` 读取已有的 DSH session 事件，在失败后回答三个实际问题：**哪里失败、证据是什么、下一次尝试前应检查什么。**

## See It Work / 立即查看效果

After a failed run, use `/postmortem`:

任务失败后，执行 `/postmortem`：

```text
Postmortem: 2 finding(s) in turn 1.
- [error] step 1: Tool shell failed. Check that the requested executable or resource exists before retrying this action.
- [error] step 1: Turn ended with error. Use the earlier tool findings as the first recovery target; do not treat the terminal state as a root cause.
```

Then use `/postmortem-repair` to get a copy-only recovery prompt. It tells the next agent attempt to verify the missing resource first and forbids repeating the same failed call unchanged.

随后执行 `/postmortem-repair` 获取仅供复制的恢复提示。它会要求下一次 agent 尝试先验证缺失资源，并禁止原样重复失败调用。

Use `/postmortem-plan` when a runner needs the same advice as strict, redacted JSON: every action includes its evidence category, an advisory action, and a verification step. Plans are copy-only and are never executed by this package.

当外部 runner 需要严格、脱敏的 JSON 建议时，使用 `/postmortem-plan`。每项动作都包含证据类别、建议动作与验证步骤；计划仅供复制，本包永不执行它们。

The output contains no user messages, tool arguments, tool output, files, prompts, credentials, or raw traces. Run the same redacted demonstration locally with `npm run build && npm run demo`.

输出不包含用户消息、工具参数、工具输出、文件、提示词、凭据或原始轨迹。可通过 `npm run build && npm run demo` 在本地运行同一脱敏演示。

## Install In 60 Seconds / 60 秒安装

```sh
dsh plugin --profile <profile-name> add @huichangzz/dsh-postmortem
```

This installs the package into the selected DSH profile and registers its bundle layer automatically. Restart that profile, then run `/postmortem` after a failed turn. No manual Loader entry is needed.

这会将包安装到选定的 DSH profile，并自动注册它的 bundle 层。重启该 profile 后，在失败 turn 后执行 `/postmortem`。无需手动添加 Loader 条目。

To enable the optional model review, add this override to that profile's `cordis.patch.yml`:

若要启用可选的模型复盘，将下列覆盖项加入该 profile 的 `cordis.patch.yml`：

```yaml
- id: postmortem
  config:
    model:
      enabled: true
      provider: your-provider
      model: your-model
      timeoutMs: 10000
```

`autoOnFailure` defaults to `detected`: it prints only actionable detected failures, not ordinary completion or user cancellation. Set it to `false` during noisy development, or `all` to retain legacy logging of every non-completed turn. No key is configured or stored by this package. The optional model layer reuses DSH's configured `llm` service; the deterministic report remains available if that model is slow, unavailable, or invalid.

`autoOnFailure` 默认值为 `detected`：只打印可行动的已检测故障，不打印普通完成或用户取消。噪声较多的开发场景可设为 `false`；设为 `all` 可保留旧版对每个未完成轮次的日志。本包不配置也不存储任何密钥。可选模型层复用 DSH 已配置的 `llm` 服务；即使模型缓慢、不可用或返回无效内容，确定性报告仍然可用。

## What You Get / 你会得到什么

| When a run fails / 失败场景 | DSH Postmortem / 复盘结果 |
| --- | --- |
| A tool returns an error / 工具返回错误 | Failed step, tool name, error code, and a bounded check before retry. / 失败步骤、工具名、错误码与重试前的具体检查。 |
| The same call keeps failing / 同一调用反复失败 | Detects three or more unchanged failures using a one-way argument fingerprint. / 通过单向参数指纹识别三次及以上未变更失败。 |
| A turn ends unexpectedly / 轮次异常结束 | Separates the terminal state from the earlier causal evidence. / 将终止状态与更早的因果证据区分开。 |
| A user stops the run / 用户主动终止 | Reports cancellation without inventing a repairable agent failure. / 报告取消，不杜撰可修复的 agent 故障。 |

### Commands / 命令

| Command / 命令 | Use / 用途 |
| --- | --- |
| `/postmortem [turn\|from-to\|--last-failed]` | Read the latest, selected, range, or most recent failed turn. The first line distinguishes an open live status from an ended turn. / 查看最新、指定、范围或最近失败轮次；首行会区分开放轮次的实时状态与已结束轮次。 |
| `/postmortem-plan [turn\|from-to\|--last-failed]` | Export schema-v1 copy-only repair actions with verification steps. / 导出带验证步骤的 schema-v1 仅复制修复动作。 |
| `/postmortem-repair [turn\|from-to\|--last-failed]` | Copy a bounded recovery prompt for a fresh agent attempt, never a session that is still running. / 复制用于新 agent 尝试的受限恢复提示，不能粘贴进仍在运行的 session。 |
| `/postmortem-export [turn\|from-to\|--last-failed]` | Export a redacted schema-v2 report, or a range envelope, for issue filing or evaluation. / 导出脱敏 schema-v2 报告或范围封装，用于提交 issue 或评测。 |
| `/postmortem-feedback [turn\|from-to\|--last-failed]` | Render a redacted issue template with plugin version and report. It does not upload or copy data. / 生成含插件版本与报告的脱敏 issue 模板；不会上传或复制数据。 |

Commands use `recordInput: false`: selecting a historical turn does not enter the session event log. Text reports show at most four findings and explicitly link to full export when truncated; structured plans retain all findings. The repair and feedback commands only return text or JSON. They never retry a tool, change the agent loop, inject a follow-up, copy data, or become model context.

命令使用 `recordInput: false`：选择历史轮次不会进入 session event log。文本报告最多显示四条 finding，截断时会明确提示完整导出；结构化计划保留全部 finding。修复与反馈命令只返回文本或 JSON，不会重试工具、改变 agent loop、注入 follow-up、复制数据或进入模型上下文。

When DSH has scheduled a provider retry, `/postmortem` returns immediate local status instead of waiting for a terminal turn. It retains only retry count, step, delay, mode, finite retry budget, and error code; provider details and failure messages are discarded. This live status never invokes the optional review model or emits a repair prompt.

当 DSH 已调度 provider 重试时，`/postmortem` 会立即返回本地状态，无需等待 turn 终止。它仅保留重试次数、步骤、延迟、模式、有限重试预算和错误码；provider 细节与失败消息都会被丢弃。该实时状态不会调用可选复盘模型，也不会生成 repair prompt。

## Built For, Not Around / 适合什么，不做什么

This is a failure-explanation and recovery-planning plugin for DSH users who need a safe next action after an agent run fails. It is deliberately **not** an autonomous retry system, a trace-upload service, or a replacement for task-level observability.

它面向需要在 agent 运行失败后获得安全下一步动作的 DSH 用户，是故障解释与恢复规划插件。它刻意**不是**自动重试系统、轨迹上传服务，也不替代任务级可观测性。

The compatibility target is DSH `0.1.1-rc.2` and Cordis `4.0.1`. DSH is in developer preview; the public session-event vocabulary is this plugin's compatibility boundary.

兼容性目标为 DSH `0.1.1-rc.2` 与 Cordis `4.0.1`。DSH 仍处于 developer preview；本插件以公开 session event 词汇表作为兼容性边界。

Headless collectors may degrade `tool/call` fields. Non-empty `callId` values are the only cross-event merge keys; when IDs are empty, calls remain distinct and the matching empty-ID results pair FIFO by the same DSH step. Canonical `assistant/message` tool-call blocks may restore metadata; otherwise a safe first command token (for example `cat`) is used only when it passes a restrictive allowlist, and the literal `unknown tool` is shown otherwise. Retry grouping excludes presentation-only fields such as `description` only when executable input remains; unknown tools never become a guessed retry loop.

headless collector 可能降级 `tool/call` 字段。只有非空 `callId` 能跨事件合并；ID 为空时，每个调用仍独立保留，且同一 DSH step 的空 ID result 会按 FIFO 配对。规范 `assistant/message` 中的 tool-call block 可补回元数据；否则只会在命令首 token 通过严格白名单时显示它（例如 `cat`），其余显示为 `unknown tool`。重试分组只会在仍有可执行输入时忽略 `description` 等展示性字段；未知工具绝不会被猜成重试环。

## Privacy And Reliability / 隐私与可靠性

The local rules identify failed tools, absent results after a closed turn, unchanged retries, terminal causes, and user cancellation. Reports retain only turn number, step, tool name, opaque call ID, error code, and event sequence number. Raw messages, arguments, outputs, files, prompts, credentials, and session traces are never retained or exported.

本地规则识别失败工具、已结束轮次中的缺失结果、未变更重试、终止原因与用户取消。报告仅保留轮次号、步骤、工具名、不透明 call ID、错误码和事件序号。原始消息、参数、输出、文件、提示词、凭据与 session trace 永不保留或导出。

Optional model review receives at most four redacted findings, has a 240-token cap and a 10-second default timeout. It may select only an existing finding and must return strict JSON; invalid, timed-out, or unavailable output is discarded.

可选模型复盘最多接收四条脱敏 finding，输出上限为 240 token，默认超时为 10 秒。它只能选择已有 finding，且必须返回严格 JSON；无效、超时或不可用的输出会被丢弃。

## Feedback That Helps / 有价值的反馈

The fastest way to improve the plugin is a real, redacted diagnosis that was wrong, incomplete, or unhelpful. [Open an issue](https://github.com/zzh-newlearner/dsh-postmortem/issues/new/choose) with the exported report, DSH/plugin versions, and the expected result. The issue form explicitly excludes secrets and raw traces.

最能推动插件改进的是一份真实但脱敏的诊断：它错误、不完整，或没有帮助。请通过 [issue](https://github.com/zzh-newlearner/dsh-postmortem/issues/new/choose) 提交导出的报告、DSH/插件版本与预期结果；表单明确禁止提交密钥和原始轨迹。

## Evaluation And Evidence / 评测与证据

The package has 24 versioned seed records: 15 redacted records derived from public DSH `dsh-v0.1.1-rc.2` snapshots or test fixtures, plus nine records constructed from the public session-event vocabulary. Every record includes source path, revision, MIT license, and acquisition date. See [datasets/README.md](datasets/README.md) for the source and redaction policy.

本包包含 24 条版本化 seed 记录：15 条由公开 DSH `dsh-v0.1.1-rc.2` snapshot 或测试 fixture 脱敏派生，9 条依据公开 session event 词汇表构造。每条记录都包含来源路径、revision、MIT 许可证与获取日期。来源和脱敏策略见 [datasets/README.md](datasets/README.md)。

Seed labels protect deterministic parser and rule regressions. They are not a claim of precision, recall, model quality, or task-success improvement. Those claims require double-reviewed or adjudicated human holdout labels and a paired runner evaluation. The published schemas are [annotations](schemas/diagnosis-annotation-v1.schema.json), [adjudication](schemas/diagnosis-adjudication-v1.schema.json), [paired runs](schemas/paired-run-v1.schema.json), and [repair plans](schemas/repair-plan-v1.schema.json).

Seed 标签用于防止确定性 parser 与规则回归，不能作为 precision、recall、模型质量或任务成功率提升的结论。这些结论需要双人审阅或裁决的人工留出集标签，以及配对 runner 评测。已发布 [标注](schemas/diagnosis-annotation-v1.schema.json)、[裁决](schemas/diagnosis-adjudication-v1.schema.json)、[配对运行](schemas/paired-run-v1.schema.json) 与 [修复计划](schemas/repair-plan-v1.schema.json) schema。

`datasets/synthetic-paired-v1` is a transparent, synthetic fixture for the paired evaluator. Run `npm run eval:paired` to validate matching, exclusions, wins, ties, and losses. Its numeric output is deliberately **not** a product-success metric; only pre-registered, matched DSH task reruns may support that claim.

`datasets/synthetic-paired-v1` 是配对评测器的透明合成 fixture。运行 `npm run eval:paired` 可验证匹配、排除、胜出、平局与失败。其数值输出刻意**不是**产品成功率指标；只有预注册、匹配的 DSH 任务重放才能支持该结论。

For a task-success claim, use `evaluateVerifiedPairs()` and the [verified-pair schema](schemas/verified-paired-run-v1.schema.json). It rejects a pair unless both arms share a protocol ID, task fingerprint, environment fingerprint, and success-criterion fingerprint; baseline must have no intervention, while the postmortem arm must identify a repair-plan fingerprint. Run `npm run eval:verified` to inspect the synthetic negative controls. This checks experiment integrity, not whether a task runner itself is correct.

若要声明任务成功率提升，请使用 `evaluateVerifiedPairs()` 和 [严格配对 schema](schemas/verified-paired-run-v1.schema.json)。除非两臂共享 protocol ID、任务指纹、环境指纹和成功判据指纹，否则评测器会排除该配对；baseline 不得有干预，postmortem 臂必须标识修复计划指纹。运行 `npm run eval:verified` 可查看合成负对照。它检查实验完整性，而不验证任务 runner 本身是否正确。

For an OpenAI-compatible model protocol smoke test, use the redacted-only runner below. It preflights models, round-robins work fairly, and opens a rate-limit circuit after the first 429.

若要进行 OpenAI-compatible 模型协议 smoke test，可使用下面只发送脱敏 finding 的 runner。它会预检模型、公平轮转任务，并在首个 429 后打开限流熔断。

```sh
POSTMORTEM_EVAL_BASE_URL=https://api.example.com/v1 \
POSTMORTEM_EVAL_API_KEY=your-key \
POSTMORTEM_EVAL_MODELS=model-a,model-b \
npm run eval:models
```

## Development / 开发

```sh
npm install
npm run typecheck
npm test
npm run build
npm run demo
npm run selfcheck:dsh
npm run eval:paired
npm run eval:verified
npm pack --dry-run
```

`npm run selfcheck:dsh` exercises the built package through DSH's real session, command, and LLM services. It verifies the five user commands, redaction of tool inputs and outputs, and the no-injection boundary without calling a model or a tool.

`npm run selfcheck:dsh` 通过 DSH 真实的 session、command 与 LLM 服务执行构建产物，验证五个用户命令、工具输入输出脱敏与不注入边界，不调用模型或工具。

The regression suite also replays degraded headless event shapes: empty calls must not collapse, canonical assistant blocks restore matching metadata, result-only IDs remain visible, and regenerated descriptions do not split a stable executable retry. Release validation should additionally run DSH's official keyless headless end-to-end fixture, which drives the real Loader, persisted SessionEvent stream, and local bash tool with a mock model.

回归套件还会重放降级的 headless 事件：空调用不能塌缩，规范 assistant block 必须补回匹配元数据，只有结果的 ID 仍可见，重新生成的描述不能拆散同一可执行重试。发布验收还应运行 DSH 官方无凭据 headless 端到端 fixture，它会以 mock 模型驱动真实 Loader、持久化 SessionEvent 流和本地 bash 工具。

## License / 许可证

[MIT](LICENSE)
