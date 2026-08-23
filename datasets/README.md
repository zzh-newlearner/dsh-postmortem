# Evaluation Seed Data / 评测种子数据

`dsh-public-v0.1.1-rc.2` is a small, versioned regression corpus for the deterministic postmortem rules. It contains 16 redacted records: seven records derived from public DeepSeek Harness snapshot fixtures and nine records constructed from the public DSH session-event vocabulary. It is a seed corpus, not an independently human-adjudicated benchmark.

`dsh-public-v0.1.1-rc.2` 是用于确定性复盘规则的一个小型、版本化回归语料。它包含 16 条脱敏记录：其中 7 条从公开 DeepSeek Harness snapshot fixture 派生，9 条按公开 DSH session event 词汇表构造。它是种子语料，不是经过独立人工裁决的 benchmark。

## Source And License / 来源与许可证

Public-source records come from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`dsh-v0.1.1-rc.2`), acquired on 2026-08-23. The upstream project is MIT licensed. Each record names its exact upstream path and provenance in `records.jsonl`; the corpus manifest repeats the source revision and license.

公开来源记录来自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`），获取日期为 2026-08-23。上游项目采用 MIT 许可证。每条记录在 `records.jsonl` 中标注了准确的上游路径与来源信息，manifest 也重复记录 source revision 和许可证。

## Redaction / 脱敏

Only event type, event sequence, turn, step, opaque call ID, tool name, error flag, error code, and end reason remain. The corpus removes user and assistant text, tool arguments, tool output, filesystem paths, credential values, and other message content. Synthetic retry records use fixed, non-user placeholders only to exercise equality detection.

语料只保留事件类型、事件序号、轮次、步骤、不透明 call ID、工具名、错误标记、错误码和结束原因。它删除用户与 assistant 文本、工具参数、工具输出、文件系统路径、凭据值及其他消息内容。合成的 retry 记录只使用固定、非用户占位符来覆盖相等性检测。

## Labels And Use / 标签与使用方式

`expected` labels are curated from explicit session-event facts and are marked `seed`. They protect parser and rule regressions; they must not be used to claim precision, recall, model quality, or task-success uplift. Promote a record to a human-quality benchmark only after two independent reviewers label the primary issue, evidence steps, and actionability, and disagreements are adjudicated.

`expected` 标签从明确的 session-event 事实整理而来，并标记为 `seed`。它们用于防止 parser 和规则回归；不得据此宣称 precision、recall、模型质量或任务成功率提升。只有两名独立审阅者标注主要问题、证据步骤和可行动性，并裁决分歧后，记录才能升级为人工质量 benchmark。

Run `npm test` to score the deterministic rules against every record. `scoreDiagnosisCorpus()` exposes the same regression metrics for external runners.

运行 `npm test` 可对每条记录验证确定性规则。`scoreDiagnosisCorpus()` 为外部 runner 提供相同的回归指标。

For human review, create one annotation per reviewer using [`schemas/diagnosis-annotation-v1.schema.json`](../schemas/diagnosis-annotation-v1.schema.json). Use pseudonymous reviewer IDs and keep notes within the same redaction policy; a second reviewer and adjudication are required before interpreting agreement or quality metrics.

人工复核时，每位审阅者应按照 [`schemas/diagnosis-annotation-v1.schema.json`](../schemas/diagnosis-annotation-v1.schema.json) 创建一条 annotation。使用匿名 reviewer ID，并让 notes 遵守相同的脱敏规则；在解释一致性或质量指标之前，必须有第二位审阅者和分歧裁决。
