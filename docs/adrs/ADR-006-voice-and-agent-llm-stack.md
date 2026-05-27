# ADR-006: OpenAI Realtime (`gpt-realtime`) via LiveKit Agents for voice; OpenAI GPT-5 + GPT-5-mini split for the inner agent, behind a provider-agnostic abstraction

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

[ADR-004](./ADR-004-modalities-and-sensors.md) commits to voice-in across the session and TTS-out *only* for the explain-back prompt. The voice channel carries three loads: pedagogical (verbal self-explanation per Chi 1994), integrity (audio-native disfluency capture as an LLM-cheating defense), and conversational (on-topic Q&A with the inner agent).

[ADR-005](./ADR-005-adaptive-ui-runtime-contract.md) commits to the inner agent emitting one structured `Action` per turn, with LLM calls only at phase boundaries (~5–10 per lesson). Action shape includes `mount`, `transition`, `answer_question`, `no_action`, each with a rationale.

This ADR locks the realtime voice provider, the LLM provider(s) for the inner agent, and the eval/observability stack that wraps them. [ADR-007](./ADR-007-orchestration-division-of-labor.md) covers how LangGraph/LangChain/LangSmith plug in.

## Options considered

### Voice provider

**A — OpenAI Realtime (`gpt-realtime`) via LiveKit Agents (chosen).** Audio-native model captures hesitation/disfluency/prosody directly — load-bearing for ADR-004's anti-cheat thesis. LiveKit Agents provides production-grade WebRTC (including iOS Safari), server-side barge-in, and orchestration that can swap to other providers (Gemini Live) without rewriting the integration surface. Verified May 2026 pricing: $32/M audio input tokens, $64/M output tokens; ~$0.05–$0.10/min cached, $0.18–$0.46/min uncached.

**B — OpenAI Realtime direct (no LiveKit).** Faster start; lose production-grade interruption handling and cross-browser polish.

**C — Gemini 2.x Live.** Cheaper, native multimodal video. Smaller ecosystem, less mature WebRTC story in 2026. Live-video advantage is moot given [ADR-004](./ADR-004-modalities-and-sensors.md) drops multi-device.

**D — Assembled stack: Deepgram Nova-3 STT + LLM text + ElevenLabs TTS.** Maximum control over the model; *loses the audio-native disfluency signal*. Wrong tool given ADR-004's anti-cheat thesis depends on prosody analysis the LLM only sees if it processes raw audio.

### Inner-agent LLM

**E — OpenAI GPT-5 (high-stakes) + GPT-5-mini (routing), provider-agnostic abstraction (chosen).** 5 for mastery/transfer/rubric turns; 5-mini for next-item/rephrase/hint/topic classification. Unified billing with Realtime. Abstraction layer means we can A/B Anthropic Claude 4.x on the same Action schema in week 4 if hallucination rate or content quality merits it.

**F — Single model for everything.** Simpler; pay over for the cheap routing turns or sacrifice quality on the high-stakes ones.

**G — Anthropic Claude 4.x Sonnet for the inner agent.** Strong reasoning; tool-use is the structured-output interface; second bill. Defensible if Anthropic's tutoring content quality wins on eval.

**H — Multi-provider from day one (OpenAI Realtime + Claude inner agent).** Best-of-breed; two SDKs; double eval surface area. Ambitious for MVP.

### Eval / observability

**I — LangSmith + PostHog + OpenTelemetry (chosen).** LangSmith for LLM call tracing and eval pipelines (pairs with LangGraph in [ADR-007](./ADR-007-orchestration-division-of-labor.md)). PostHog for session replay and product analytics — irreplaceable for the brief's "did the UI churn too much" counter-metric, which is best evaluated by *watching* sessions, not by reading logs. OpenTelemetry for vendor-neutral voice-loop traces (turn latency, barge-in events, transcript fidelity per turn).

**J — Braintrust + PostHog + OpenTelemetry.** Strong eval pipeline alternative; doesn't match the LangChain stack as smoothly.

**K — Roll our own logging.** Cheapest; skips polish; risky for the brief's counter-metric demand.

## Decision

### Voice

- **`gpt-realtime`** as the realtime audio model, accessed via **LiveKit Agents** as the orchestration layer. Browser ↔ LiveKit ↔ OpenAI Realtime WebRTC pipeline with ephemeral session tokens minted server-side.
- **Voice-in (always available during a lesson):** captured continuously when the learner has explicitly toggled the microphone affordance; transmitted via WebRTC. The model emits both audio response capability and an aligned text transcript stream we log per turn.
- **Voice-out (only for the explain-back prompt):** the agent's `ExplainBackPrompt` component triggers a single ~3-second TTS read via the Realtime API; the response window starts immediately on prompt completion with a 15-second cap.
- **Aggressive caching:** the system prompt, tutor persona, current lesson state, and recent conversation context are all cached. Per verified pricing, caching turns audio cost down 3–5×.
- **Barge-in / interruption:** handled by LiveKit Agents' default behavior (server-side VAD on the OpenAI side stops the model's response when learner audio is detected).

### Inner-agent LLM

- **GPT-5** for the four high-stakes turn kinds: mastery proposal, transfer-probe construction, explain-back rubric evaluation, ambiguous transition decisions. ~5–10 calls per lesson.
- **GPT-5-mini** for the high-frequency, lower-stakes turn kinds: next practice item, rephrase request, hint level/body, topic classification. ~10–20 calls per lesson.
- Both go through a provider-agnostic abstraction (`AgentClient` interface) so we can swap to Anthropic Claude or Gemini per-turn-kind on a config flag during week-4 eval.
- Structured outputs (`response_format: { type: "json_schema", strict: true }`) constrain every call to the `Action` schema from [ADR-005](./ADR-005-adaptive-ui-runtime-contract.md). One retry on schema violation; persistent malformation falls back to `no_action`.

### Vision / handwriting

- **Out of scope for MVP and stretch** per [ADR-004](./ADR-004-modalities-and-sensors.md). No camera APIs accessed. No image upload. No multi-device.
- Documented in the Limitations memo as a future direction for handwriting-native domains (physics, chemistry, geometry).

### Eval / observability stack

- **LangSmith** for LLM call tracing, prompt-version control, and eval pipelines (regression tests over labelled scenarios). Every Action emit logged with input snapshot, prompt, response, rationale, statechart decision.
- **PostHog** for product analytics + session replay. Replay is *essential* for the counter-metric "did the UI change too often?" — only visible by watching sessions; not extractable from logs.
- **OpenTelemetry** for voice-loop traces: turn TTFT, barge-in events, transcript fidelity per turn, error rates by network condition. Vendor-neutral so we can replay traces against an alternative voice provider if we A/B Gemini Live.

## Rationale

### Why audio-native realtime is required (not just nice-to-have)

[ADR-004](./ADR-004-modalities-and-sensors.md)'s voice-as-anti-cheat thesis depends on capturing prosody, hesitation, restarts, and reading-vs-thinking pause patterns. STT discards exactly that signal — the LLM downstream of STT sees only text and timestamps, not the underlying audio dynamics. The Realtime API processes audio directly and can be prompted with "log a `disfluency` event when you hear filled pauses ('um', 'uh'), or a >2-second silent pause mid-utterance." That gives us a defensible integrity signal an STT pipeline cannot.

### Why the GPT-5 / GPT-5-mini split

Inner-agent turns have a sharply bimodal cost-quality curve. Mastery decisions and rubric evaluations need the strongest available model — these turns are <10% of total calls and the cost is negligible at prototype scale. Routing turns (rephrase / next-item / topic classification) are 80%+ of calls; using a strong model for these pays for performance we don't need. Mini is faster (lower TTFT) and an order of magnitude cheaper; it's the right tool for the routing job.

The provider-agnostic abstraction is the insurance policy. If our week-3 eval shows GPT-5 hallucinating on De Morgan's misconceptions (or Claude doing it better), we swap on a config flag without rewriting integration code.

### Why LangSmith over Braintrust here

LangSmith is the native eval surface for the LangChain stack we're committing to in [ADR-007](./ADR-007-orchestration-division-of-labor.md). Mixing Braintrust into a LangChain stack works but adds an SDK and a bill for something LangSmith already does. Braintrust's eval-pipeline polish is its main advantage; LangSmith's eval pipelines are now broadly comparable in 2026.

### Why PostHog session replay is non-negotiable

The brief lists "Did the UI change too often?" as a counter-metric. The only honest way to evaluate that is to watch real sessions and count UI changes per minute of learner engagement, then compare against learner self-reports of disorientation. Logs give us the agent's *decisions*; only replay gives us the learner's *experience* of those decisions. Without replay, our counter-metric story is logs-only and weaker.

### Defensibility for Nerdy

- **Dalmia (VP Eng, ex-Amazon/Google)** will recognise LiveKit Agents as the right call for production realtime audio — it's the open-source standard for voice agents in 2026. He'll respect the GPT-5/mini split as cost-engineering discipline (the Amazon way of doing it).
- **Hunigan (VP AI, ex-Capacity)** will recognise the structured-output + provider-abstraction pattern from production AI customer-service work; it's how serious AI products de-risk model-vendor dependency.
- **The audio-native disfluency story is a fresh angle on integrity** that most submissions will miss. Naming the cheating threat and showing the model-level defense is a strong evaluator signal.

## Tradeoffs & risks

- **Two providers in production (OpenAI for everything; LiveKit for orchestration).** Mitigation: LiveKit Agents is open-source and self-hostable; the lock-in is on OpenAI for the realtime model, mitigated by the provider-agnostic abstraction at the application layer (we can swap to Gemini Live by reconfiguring the LiveKit agent).

- **GPT-5 / mini split adds a routing decision per turn.** Mitigation: the routing decision is by *turn kind*, not by content — a static lookup, not an extra LLM call.

- **Caching strategy depends on the realtime API's caching being correctly invoked.** Mitigation: explicit tests in week 2 that verify cached-vs-uncached cost differential matches the documented 3–5× ratio. If caching is mis-invoked we'll see the bill spike.

- **iOS Safari WebRTC quirks** (autoplay audio policies, microphone permission persistence). Mitigation: explicit cross-platform test matrix in week 3 includes iOS Safari, Android Chrome, desktop Chrome, desktop Safari, desktop Firefox.

- **Realtime-API model deprecation.** OpenAI has shipped 3+ Realtime model versions since 2024. Mitigation: depend on the model family alias (`gpt-realtime`) rather than a specific version pin; eval on each release within a week of availability.

- **LangSmith is OpenAI-friendly but Anthropic-callable through its provider abstractions** — fine for our use, but Anthropic-native eval (Statsig, internal tools) would be richer if we end up swapping providers. Mitigation: LangSmith covers our needs at prototype scale; revisit if we go to production multi-provider.

- **TTS only for the explain-back prompt** means we're not building a general TTS layer. Mitigation: this is the right scope; if a future direction needs more TTS surface area, it's straightforward to add — the Realtime API supports it natively.

- **PostHog session replay is privacy-sensitive** for a tutoring product. Mitigation: replay is *off* by default in production; *on* for internal eval sessions with informed consent. The privacy posture (see [Round 8 — stretch features, FERPA/accessibility]) names this explicitly.

## Consequences for the build

- **Ephemeral-token minting endpoint** (`POST /api/realtime/session`) issues short-lived tokens for the browser to connect directly to LiveKit. No long-lived OpenAI API keys ship to the browser.
- **LiveKit Agents Python or Node service** runs the agent-side bridge; we use the Node integration since the rest of the stack is TypeScript.
- **`AgentClient` interface** abstracts the structured-output LLM call. Concrete implementations: `OpenAIAgentClient`, `AnthropicAgentClient`. The Action schema validation is the same regardless of provider.
- **Caching strategy**: system prompt + tutor persona + current lesson state are constructed once per session and re-used across turns. Tool outputs are *not* sent back as audio (text only) — this matters per the OpenAI caching guide.
- **LangSmith project structure**: one project per environment (`dev`, `eval`, `demo`); evals run against labelled scenario sets stored alongside the code.
- **PostHog group key** is the session ID; replay is off-by-default, on for opt-in eval sessions.
- **OTel attributes** on every voice turn include: `turn_id`, `learner_id`, `lesson_id`, `phase`, `model_version`, `cache_hit`, `ttft_ms`, `barge_in`, `transcript_log_id`.
- **The eval scenario bank** for LangSmith covers: De Morgan halfway-application detection, NAND-universality misconception, off-topic question deflection, explain-back rubric pass/fail edge cases, transfer-probe item construction, hint-ladder progression. Week-1 deliverable.
