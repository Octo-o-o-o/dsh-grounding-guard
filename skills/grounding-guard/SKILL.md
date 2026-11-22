---
name: grounding-guard
description: Enforce deterministic citation grounding, truncated-read honesty, zero-authored-number answerBlocks, write receipts, and bounded self-correction in DeepSeek Harness.
---

# Grounding Guard Skill

When `dsh-grounding-guard` is installed, follow these evidence rules:

1. **Cite registered evidence IDs verbatim**: Use `[ev:<id>]` or `[source:<id>]` matching actual evidence captured from tool reads or `dsh-local-kb`. Never fabricate IDs or quotes.
2. **Never make exhaustive claims on truncated reads**: If a tool or KB read returns `truncated: true` with `nextOffset`, either continue reading or explicitly state the result is partial.
3. **Structured data answers (`answerBlocks` v2)**: For numeric query outputs, emit strict `version: 2` JSON blocks (`fact`, `table`, `metadata`, `choice`, `notice`) referencing exact `runId`, `row`, and `column` — never invent numbers in free text.
4. **No absolute generalizations in memory writes**: Avoid unquoted absolute words (`总是`, `从不`, `一定`, `always`, `never`, `definitely`) when distilling user profile or memory notes unless directly quoting user text or using explicit negation.
5. **Honest verdicts**: If verification fails after bounded self-correction (default max 1 retry), surface `unverified` or `contradicted` honestly rather than hiding uncertainty.
