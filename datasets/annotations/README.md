# Human Annotations / 人工标注

Store one JSON object per line in a local, access-controlled annotation file. Do not commit annotations that contain user content, tool input/output, paths, or credentials.

每行保存一个 JSON 标注对象，并将标注文件保存在本地受控位置。不得提交包含用户内容、工具输入/输出、路径或凭据的标注。

1. Two independent pseudonymous reviewers annotate each record with [`diagnosis-annotation-v1`](../../schemas/diagnosis-annotation-v1.schema.json).
2. Exact agreement produces a `human_agreement` reference.
3. Any disagreement requires one [`diagnosis-adjudication-v1`](../../schemas/diagnosis-adjudication-v1.schema.json) object naming both reviewers.

1. 两位独立、匿名审阅者按 [`diagnosis-annotation-v1`](../../schemas/diagnosis-annotation-v1.schema.json) 标注每条记录。
2. 完全一致时才生成 `human_agreement` 参考标签。
3. 任一分歧都需要一条列出两位审阅者的 [`diagnosis-adjudication-v1`](../../schemas/diagnosis-adjudication-v1.schema.json) 裁决记录。
