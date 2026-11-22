# dsh-grounding-guard

[中文](./README.md)

Deterministic anti-hallucination, evidence bus, reverse quote locator, zero-authored-number `answerBlocks` validator, write-receipt convergence, and optional fail-closed NLI verification plugin for DeepSeek Harness (`dsh@0.2.2-rc.5`). Zero runtime dependencies.

## Features

- **Source-Agnostic Evidence Bus (`ctx.governanceEvidence`)**: Passively captures built-in file/search tool reads and truncation flags (`truncated`, `nextOffset`), while accepting structured evidence from sibling plugins such as `dsh-local-kb` or custom data query tools.
- **Stage 1 Deterministic Checks (Default On, Zero Extra LLM Cost)**:
  - Fabricated `[ev:id]` / `[claim:id]` / `[source:id]` citation detection.
  - Exact & whitespace-normalized reverse quote locator against registered evidence text.
  - Truncated-read exhaustive-claim detector (catches claiming "not found in entire file" when `truncated: true`).
  - Strict `version: 2` `answerBlocks` validator & deterministic renderer (forbids model-authored numbers in prose).
  - Host-side artifact verifier (`realpath` + `lstat` + `O_NOFOLLOW` + pre/post `fstat` race detection + SHA-256 + RFC-4180 CSV schema/sum check).
  - Unquoted absolute wording guard for memory distillation writes (with quote and negation exemptions).
  - Write-tool receipt convergence (`contentKind: 'receipt'`, stripping raw body echo).
- **Bounded Self-Correction (`agent/turn-stopping`)**: Calls `agent.steer(UserMessage)` at most `maxSteerCorrections` (default `1`) times on blocking evidence failures, and persists durable `ignorable: true` plugin records (`plugin:dsh-grounding-guard/evidence-verdict`) with honest verdicts (`verified` / `partial` / `unverified` / `contradicted`).
- **Optional Stage 2 NLI Judge (Default Off, Fail-Closed)**: Calls `ctx.llm` under isolated purpose `'grounding-verify'` treating sentence & quote strictly as untrusted JSON data; fails closed to `unverified` on any error or timeout.

## Install

```bash
dsh plugin --profile web add github:Octo-o-o-o/dsh-grounding-guard
dsh web
```

## Honest Boundaries

- Deterministic grounding dramatically reduces fabricated citations, truncated-read mistakes, and invented query numbers, and exposes verification gaps honestly—it does **not** claim "zero hallucinations" for uncited general-knowledge prose.
- Enabling Stage 2 NLI adds per-turn latency and token usage; unavailable judges always fail closed to `unverified`.

## License

[Apache-2.0](./LICENSE) — Copyright 2026 OctoLab (`Octo-o-o-o`).
