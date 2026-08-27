# Evaluation Seed Data / 评测种子数据

`dsh-public-v0.1.1-rc.2` is a small, versioned regression corpus for the deterministic postmortem rules. It contains 24 redacted records: 15 records derived from public DeepSeek Harness snapshot or test fixtures and nine records constructed from the public DSH session-event vocabulary. It is a seed corpus, not an independently human-adjudicated benchmark.

`dsh-public-v0.1.1-rc.2` 是用于确定性复盘规则的一个小型、版本化回归语料。它包含 24 条脱敏记录：其中 15 条从公开 DeepSeek Harness snapshot 或测试 fixture 派生，9 条按公开 DSH session event 词汇表构造。它是种子语料，不是经过独立人工裁决的 benchmark。

## Source And License / 来源与许可证

Public-source records come from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`dsh-v0.1.1-rc.2`), acquired on 2026-08-23. The upstream project is MIT licensed. Each record names its exact upstream path and provenance in `records.jsonl`; the corpus manifest repeats the source revision and license.

公开来源记录来自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`），获取日期为 2026-08-23。上游项目采用 MIT 许可证。每条记录在 `records.jsonl` 中标注了准确的上游路径与来源信息，manifest 也重复记录 source revision 和许可证。

## Redaction / 脱敏

Only event type, event sequence, turn, step, opaque call ID, tool name, error flag, error code, end reason, and abort cause remain. The corpus removes user and assistant text, tool arguments, tool output, filesystem paths, credential values, and other message content. Synthetic retry records use fixed, non-user placeholders only to exercise equality detection.

语料只保留事件类型、事件序号、轮次、步骤、不透明 call ID、工具名、错误标记、错误码、结束原因和取消原因。它删除用户与 assistant 文本、工具参数、工具输出、文件系统路径、凭据值及其他消息内容。合成的 retry 记录只使用固定、非用户占位符来覆盖相等性检测。

## Labels And Use / 标签与使用方式

`expected` labels are curated from explicit session-event facts and are marked `seed`. They protect parser and rule regressions; they must not be used to claim precision, recall, model quality, or task-success uplift. Promote a record to a human-quality benchmark only after two independent reviewers label the primary issue, evidence steps, and actionability, and disagreements are adjudicated.

`expected` 标签从明确的 session-event 事实整理而来，并标记为 `seed`。它们用于防止 parser 和规则回归；不得据此宣称 precision、recall、模型质量或任务成功率提升。只有两名独立审阅者标注主要问题、证据步骤和可行动性，并裁决分歧后，记录才能升级为人工质量 benchmark。

Run `npm test` to score the deterministic rules against every record. `scoreDiagnosisCorpus()` exposes the same regression metrics for external runners.

运行 `npm test` 可对每条记录验证确定性规则。`scoreDiagnosisCorpus()` 为外部 runner 提供相同的回归指标。

For human review, create one annotation per reviewer using [`schemas/diagnosis-annotation-v1.schema.json`](../schemas/diagnosis-annotation-v1.schema.json). Use pseudonymous reviewer IDs and keep notes within the same redaction policy; a second reviewer and adjudication are required before interpreting agreement or quality metrics.

人工复核时，每位审阅者应按照 [`schemas/diagnosis-annotation-v1.schema.json`](../schemas/diagnosis-annotation-v1.schema.json) 创建一条 annotation。使用匿名 reviewer ID，并让 notes 遵守相同的脱敏规则；在解释一致性或质量指标之前，必须有第二位审阅者和分歧裁决。

The stable evaluation split is `sha256(record id)` modulo five: holdout when the first byte is zero, otherwise development. It is intended to prevent record movement while the corpus grows, not to make the seed labels into a benchmark.

稳定评测划分使用 `sha256(record id)` 的首字节模五：为零时是 holdout，否则为 development。它用于确保语料增长时已有记录不移动，不会把 seed 标签变成 benchmark。

## Synthetic Paired Fixture / 合成配对 Fixture

`synthetic-paired-v1` contains eight fully synthetic baseline/postmortem pairs. It is authored in this repository on 2026-08-27, licensed MIT, and has no external source or user trace. Its only purpose is to regression-test paired-run matching and aggregation, including a negative control. Run `npm run eval:paired` to inspect it. Its reported delta is not evidence that the plugin improves real DSH task success.

`synthetic-paired-v1` 包含八组完全合成的 baseline/postmortem 配对。它于 2026-08-27 在本仓库编写，采用 MIT 许可证，不含外部来源或用户轨迹。其唯一目的，是回归测试配对运行的匹配与聚合，包括负对照。运行 `npm run eval:paired` 可查看它。其 delta 不是本插件提升真实 DSH 任务成功率的证据。

## Synthetic Verified-Pair Fixture / 合成严格配对 Fixture

`synthetic-verified-paired-v1` contains four fully synthetic pairs authored in this repository on 2026-08-27 under MIT. One pair is eligible; the others deliberately differ in environment, omit a repair-plan fingerprint, or differ in success criterion. Run `npm run eval:verified` to ensure those records are excluded. It tests protocol enforcement only and is not evidence of task-success improvement.

`synthetic-verified-paired-v1` 包含四组完全合成的严格配对，于 2026-08-27 在本仓库编写，采用 MIT。其中一组符合条件；其余分别故意改变环境、遗漏修复计划指纹或改变成功判据。运行 `npm run eval:verified` 可确保这些记录被排除。它只测试协议执行，不是任务成功率提升的证据。
