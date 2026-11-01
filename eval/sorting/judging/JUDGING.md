# Blind sorting judgement

Claude must review categories.md before starting either judge. Run two independent judges in separate empty folders:
one Claude agent and one Codex run. Copy only this instruction, categories.md, and batch-*.jsonl. Do not give either
judge access to the repository, source tags, initial answers, engine, scores, other judge or internet. These are
invented payments; business identities can be anonymised. Judge the visible text, without guessing hidden facts.

Read categories.md. Every input has an opaque id and payment fields as the app receives them. `context`, when
present, supplies other payments visible in the same scenario; assess the designated `payment`. Context is evidence
for own accounts and duplicate PayPal funding. Equal amounts alone do not prove a transfer. Money out is negative.

Write exactly one JSON object per case, one per line, with the same `id`:

```json
{"id":"example","best":"groceries","alsoRight":["coffee-snacks"]}
{"id":"example-2","best":null,"alsoRight":[],"unclear":true}
{"id":"example-3","best":"friends","alsoRight":[],"personal":true}
```

`best` is one category ID (or null); `alsoRight` is an array of every other reasonable category ID. `unclear` says
nothing in the payment identifies the purpose; `personal` says the person's context or budgeting preference is
needed. Both flags permit leaving it unsorted, and may coexist with reasonable categories. Never answer
`not-sorted`. Do not force `other`, `shopping` or `other-income` to avoid saying unclear. Consider amount direction.
Cover every case exactly once. Concatenate your batch answers into judge-1.jsonl or judge-2.jsonl, respectively.
Do not discuss or reconcile answers with the other judge. Claude runs the merge after both finish.
