# RESEARCH.md — Technologies in play

> Backgrounder for the Nerdy "Hyperresponsive Mastery UI" take-home. Audience: me (Keith), about to defend technology choices to a tutoring-product CTO. Bias: opinionated where evidence warrants, honest where it doesn't, sourced where possible.
>
> **A note on currency.** Drafted May 2026. The AI tooling layer has shipped fast — every concrete version number, price-per-minute, and "latest model" claim below should be re-confirmed against the linked official doc before quoting it in the writeup. Where I can flag "this was true 18 months ago but is now different," I have. Where I'm uncertain, I say "verify."

---

## 1. Generative & adaptive UI

This is the crux of the brief. The brief explicitly *penalizes* "we used an LLM to emit JSX and called that adaptive" — so I need to land somewhere stricter than that, and be able to point at why.

### The spectrum

There's a continuous axis between "the LLM is the designer" and "the LLM is a router into a designed system":

1. **LLM emits raw HTML/JSX** — maximally expressive, maximally chaotic. Unsafe (XSS), unstyled, untestable, breaks the brief's "no choice paralysis / stable orientation" requirement on day one. Useful only as a demo gimmick.
2. **LLM emits a JSON tree referencing a fixed component library** — the components are designed by humans; the LLM picks which to mount and with what props. This is what production "generative UI" systems actually do.
3. **LLM picks a *named scene* from a finite catalog, and only modulates parameters** — e.g. `{scene: "fraction_bar", numerator: 3, denominator: 8, highlight: 2}`. Boring-looking, but pedagogically defensible: every transition is auditable.
4. **State machine is the source of truth; LLM only suggests transitions** — the FSM defines all legal UI states, the LLM proposes which one to enter, and a deterministic guard checks it's allowed. (See §6.)

For Nerdy's brief, the right answer is roughly **3 with hints of 4**: a curated catalog of pedagogically-motivated "scenes" (problem board, hint ladder, manipulable fraction bar, transfer quiz, etc.), with the LLM doing intent-to-scene routing and a statechart guarding when scenes may switch. That's the version I can defend on a whiteboard.

### Vercel AI SDK — `streamUI` / generative UI

**One-sentence what:** A React + Node toolkit (`ai` package) that lets a server-side LLM call "tools" whose return values *are React components*, streamed into a client component tree.

**Problem it solves:** Tool-calling normally returns JSON your code then renders; `streamUI` lets the model essentially say "I want to show the user a fraction bar" and the framework mounts a real React component on the page, including while still streaming.

**Status (verified May 2026):** **AI SDK 5 is current** and is now the first AI framework with fully-typed chat for React, Svelte, Vue, and Angular plus first-class agent-loop primitives. Crucially, **development of AI SDK RSC (`streamUI` / `ai/rsc`) is officially paused** — Vercel's docs include a "Migrating from AI SDK RSC" guide and steer new work toward AI SDK UI (`useChat`, `useObject`) plus structured outputs with the components rendered client-side from typed payloads. ([AI SDK 5 — Vercel blog](https://vercel.com/blog/ai-sdk-5); [AI SDK docs](https://ai-sdk.dev/docs/introduction))

**What this means for the brief:** the path of least resistance now happens to be the path the brief demands. Don't use AI SDK RSC for new work in 2026 — own the component rendering yourself with a typed schema, and use AI SDK 5 only for the model-call + tool-call layer.

**Why this brief surfaces it:** Vercel will be the path of least resistance if I pick Next.js. It's the right tool *if* I'm streaming small, well-typed component fragments inside a chat-like surface. It's the wrong tool if my UI is a stable canvas that occasionally rearranges (which is what the brief really wants).

**Gotchas at week 3:**
- RSC streaming + client-state interaction (e.g. a manipulable fraction bar) gets ugly fast; the component tree the LLM builds is server-owned, but the *interaction state* needs to live client-side.
- Tool-call latency stacks: model time-to-first-token + tool execution + RSC stream. Easy to blow the brief's latency budget.
- `streamUI` examples are mostly "render a stock chart" toys; the brief needs persistent, manipulable workspaces, which is a different shape.

**Links:** [sdk.vercel.ai/docs](https://sdk.vercel.ai/docs) · [AI SDK GitHub](https://github.com/vercel/ai)

### Thesys C1

**One-sentence what:** A hosted "GenUI" runtime that takes an LLM response and renders it as a typed, styled React UI from a curated component library — i.e. it productizes option 2 above.

**Problem it solves:** Wraps the schema/registry/validator/renderer pipeline you'd otherwise hand-roll. You bring prompts and a component registry; it gives you a `<C1Component>` that streams the rendered UI.

**Why this brief surfaces it:** Looks shiny in a demo. The risk for Nerdy specifically is that "the UI is whatever Thesys decided to mount" undercuts the brief's required defense of *when* and *why* the UI changes — that policy is now half inside a vendor.

**Tradeoff vs. hand-rolled:** Faster start, lower control. If asked "why did the UI change at second 42 and not at second 38," I'd rather point at my own statechart than at C1's tool-routing.

**Gotchas:** vendor lock-in on the rendering layer; styling boundaries (their themes vs. my design); offline/eval reproducibility (does the same input always produce the same UI tree?); pricing scales per render.

**Links:** [thesys.dev](https://thesys.dev) · their docs / examples on the site

### tambo

**One-sentence what:** Open-source-leaning generative-UI runtime in the same shape as Thesys — register components, model picks them, library renders them.

**Why this brief surfaces it:** Same role as Thesys, less vendor risk if it's open source. Smaller ecosystem, smaller bus factor.

**Tradeoff:** Trades the hosted polish of Thesys for ownership.

**Links:** [tambo.co](https://tambo.co)

### CopilotKit

**One-sentence what:** A React library for embedding a "Copilot" (chat + actions) sidecar into an existing app, where the LLM can call functions you expose to read/write your app state.

**Problem it solves:** Bidirectional: the user can talk to the app, the app can surface suggestions. It's less "generate the UI" and more "instrument an existing UI for AI co-driving."

**Relevance to brief:** Honestly limited. The brief asks for the UI itself to be the tutoring instrument, not a chat sidekick that drives a static UI. CopilotKit fits a different product shape (a SaaS dashboard with an AI assistant on the side). Worth knowing about so I can explicitly say "rejected — wrong product shape."

**Links:** [copilotkit.ai](https://copilotkit.ai)

### Hand-rolled: LLM → Zod-validated JSON → curated React components

**The pattern:**
1. Define a Zod schema for "UIScene" — a discriminated union of every scene type you support (problem board, hint ladder, fraction-bar manipulable, transfer quiz, etc.).
2. Call the model with structured outputs (OpenAI `response_format: { type: "json_schema" }`, Anthropic tool-use, Gemini structured output) constrained to that schema.
3. Validate with Zod on the server. Reject + retry on schema violation.
4. Client receives the validated `UIScene`, looks up the component in a registry, mounts it with typed props.

**Why this is the defensible answer for Nerdy:** every legal UI is something you designed; every transition is a value you can log, replay, and eval; you can write deterministic tests that say "given learner state X, the model should propose scene Y." The brief asks me to *defend when the UI changes* — this approach gives a literal answer.

**Footguns:** schema bloat (when do you collapse "FractionBar v1" and "v2"?); structured-output retries cost latency; over-schematized props produce a UI that feels rigid (the brief also penalizes that).

### State-machine + LLM hybrid (XState as policy, LLM as advisor)

**The pattern:** XState defines all possible UI states and the *guards* on transitions. The LLM observes learner signals and proposes a transition by name; the FSM either accepts (guard passes) or ignores. The LLM never directly mounts a component.

**Why this fits Nerdy:** The brief's hardest requirement is "the interface refuses to change when it shouldn't." That refusal lives naturally in FSM guards (`canSimplify`, `canAdvance`, `canRequestTransfer`). The LLM's role drops to "what does the learner seem to need next" — a softer claim that's easier to be honest about.

**Verdict:** I'll combine this with the hand-rolled Zod approach. FSM is the source of truth for *when*; component registry is the source of truth for *what*; LLM bridges them and writes natural-language explanations of changes.

**Links:** [XState docs](https://stately.ai/docs/xstate) · [Statecharts.dev](https://statecharts.dev/)

---

## 2. Realtime voice (low-latency turn-taking)

Voice is the modality that most "makes the interface feel alive." Latency is the entire game: under ~800ms end-of-user-speech → start-of-tutor-speech is the bar for "feels like a person." Over ~1.5s and learners disengage.

### OpenAI Realtime API

**One-sentence what:** A WebSocket / WebRTC endpoint into a speech-native model (the `gpt-4o-realtime` / newer "Realtime" family) that takes raw audio in and emits audio + text out without the STT → LLM → TTS round-trip.

**Why this brief surfaces it:** It's the lowest-latency turnkey voice in the category, with native barge-in (interruption), server-side VAD, and tool calling that interleaves with the audio stream. That means I can have the tutor speak *and* mount a fraction bar in the workspace from the same model turn.

**Pricing (verified May 2026):** `gpt-realtime` is $32 per 1M audio input tokens ($0.40 cached) and $64 per 1M audio output tokens. Audio tokens are quantised as **1 token / 100ms of user audio** and **1 token / 50ms of assistant audio** — so a minute of user speech = 600 tokens, a minute of assistant TTS = 1,200 tokens. Realistic per-minute cost lands at **~$0.18–$0.46/min uncached**, dropping to **~$0.05–$0.10/min with prompt caching enabled and tool outputs trimmed**. A 30-minute tutoring session = ~$1.50–$3 cached. ([Introducing gpt-realtime — OpenAI](https://openai.com/index/introducing-gpt-realtime/); [Managing realtime costs](https://platform.openai.com/docs/guides/realtime-costs); [OpenAI API pricing](https://openai.com/api/pricing/))

At prototype scale (1,000 sessions × 10 min), this is **$500–$4,600 of voice tokens** depending on caching — not a binding cost constraint. The architecture should turn caching on (system prompt, tutor persona, exercise context) since the savings are 3–5×.

**Alternatives:**
- **Google Gemini Live API** — comparable shape, native vision in the same realtime session (so the tutor can also "see" the webcam handwriting frame without a separate vision call). Strong contender if I want voice + vision in one socket.
- **Deepgram (STT) → LLM (text) → ElevenLabs (TTS) assembled stack** — much more control over the model (you can use any text LLM), much harder to get turn-taking right. Adds 300–600ms vs. realtime APIs. Pick this only if you need a specific text model.
- **Pipecat / LiveKit Agents / Vapi** — orchestration frameworks that hide the assembly. Pipecat (open source, Daily-backed) and LiveKit Agents (open source, LiveKit-backed) are the serious options for production voice agents. Vapi is the hosted SaaS path.
- **Web Speech API** — `SpeechRecognition` + `SpeechSynthesis` in the browser. Free, zero infra. Wildly variable browser support (Chrome STT calls Google's cloud anyway; Safari is its own world). Fine for a "the user said 'next'" command channel; not fine for a tutor's voice.

**Killer concerns:**
- **Latency budget:** budget 200ms for network + audio buffer, leaves ~600ms for model. Realtime APIs hit this; assembled stacks usually don't.
- **Barge-in:** the tutor must stop talking the instant the learner starts. Realtime APIs handle this server-side; with an assembled stack you implement it yourself.
- **Hesitation detection:** silence ≠ done. You want a slow VAD on silence after partial sentences. Realtime APIs expose this through `input_audio_buffer.speech_stopped` events; tune the threshold per learner age group.
- **Transcripts for the mastery model:** the realtime APIs emit text transcripts alongside audio — log them. Without transcripts you have no mastery signal from voice.
- **Cost per minute:** at the bar prices, a 30-minute tutoring session is a few dollars in voice tokens alone. Demoable; not yet a free product.
- **Browser support:** WebRTC is universal; the OpenAI/Gemini realtime SDKs are JS-friendly; iOS Safari audio autoplay rules will bite you on first turn.

**Links:** [platform.openai.com/docs/guides/realtime](https://platform.openai.com/docs/guides/realtime) · [ai.google.dev/gemini-api/docs/live](https://ai.google.dev/gemini-api/docs/live) · [pipecat.ai](https://pipecat.ai) · [docs.livekit.io/agents](https://docs.livekit.io/agents)

---

## 3. Vision & handwriting recognition

The brief explicitly suggests "camera reads the student's handwritten work." This is the modality with the biggest gap between "looks great in demo" and "works on real paper."

### General multimodal LLMs (GPT-4o vision / Claude / Gemini vision)

**One-sentence what:** Drop an image into a prompt; the model describes / transcribes / reasons about it.

**Where they're good:** Printed text, simple diagrams, "is this a 7 or a 1," structured worksheet layouts, captioning.

**Where they fail (still, in 2026):**
- Multi-line handwritten math with carries, fractions stacked vertically, equation alignment.
- Distinguishing a student's correction (crossed-out wrong, rewritten correct) from confused mess.
- LaTeX-faithful transcription — they paraphrase.
- Hallucinated digits on low-quality phone-camera frames.

A good experiment to run in week 1: hand-write the same algebra problem ten ways and see what each model returns. Budget for surprises.

### Mathpix

**One-sentence what:** A specialist OCR API trained specifically on math (printed and handwritten), returning LaTeX / MathML.

**Why it exists:** General vision models still don't beat Mathpix on math notation accuracy. They charge per request, which adds up but is the lowest-friction "I want LaTeX back" path.

**Tradeoff vs. GPT-4o vision:** Mathpix is much more accurate on math, much narrower in scope (you still need a general model for "what did the student draw next to the equation?").

**Links:** [mathpix.com/docs/ocr](https://mathpix.com/docs/ocr)

### MyScript

**One-sentence what:** A handwriting-recognition SDK (the engine behind Nebo, Nuance's old engine) that runs on-device for ink → text / math conversion.

**Why this brief surfaces it:** If the input mode is a stylus on a tablet rather than a camera on paper, MyScript's iink SDK is the gold standard for real-time stroke recognition. On-device → zero network latency → zero privacy concerns.

**Tradeoff:** Commercial license, SDK integration, not a casual REST call.

**Links:** [developer.myscript.com](https://developer.myscript.com)

### Tesseract / PaddleOCR

**One-sentence what:** Open-source classical OCR engines.

**Relevance:** Mostly historical interest in 2026. Free, runs anywhere. Bad at handwriting; mediocre at math. Use as a fallback or for printed-worksheet structure detection, not as the primary path.

**Links:** [tesseract-ocr.github.io](https://tesseract-ocr.github.io/) · [paddlepaddle.github.io/PaddleOCR](https://paddlepaddle.github.io/PaddleOCR/)

### On-device vs. cloud

| Concern | On-device | Cloud |
| --- | --- | --- |
| Latency | 50–200ms | 300–1500ms |
| Privacy | Strong | Weak (student work leaves device) |
| Accuracy on math | Mathpix > MyScript > general models | Mathpix cloud beats them all |
| Cost at scale | Free after license | Per-request |
| Offline / classroom Wi-Fi | Works | Doesn't |

**Footguns at week 3:**
- Streaming full-res camera frames to a cloud model: expensive and slow. Sample to keyframes (~1fps) and downsample server-side.
- Lighting / paper / pen color destroy accuracy. Add a "frame the work in the box" overlay during capture.
- Math notation OCR has a fundamental hard problem: 2D layout (numerator over denominator) doesn't linearize. Even the best engines mistakenly turn `(x+1)/2` into `x+1/2` on bad handwriting.
- Don't capture continuously; capture on a learner gesture ("I'm done with this step"). Saves cost *and* gives you a clean mastery signal.

---

## 4. Direct-manipulation canvas & workspace

The brief says "direct manipulation, not just passive generated components." That's the line where most generative-UI demos fail.

### tldraw + tldraw SDK

**One-sentence what:** An open-source, extensible whiteboard built in React, with first-class support for custom "shapes" that are themselves React components — meaning a `<FractionBar>` can live on the same canvas as freehand ink.

**Why this brief surfaces it:** It's the cleanest answer to "we need a workspace where the learner can scribble freely *and* manipulate structured widgets *and* the system can read both." Custom shapes give me my pedagogical widgets; the surrounding canvas gives me ink and pan/zoom.

**Tradeoffs:** Heavyweight dependency, opinionated UX (camera/zoom behavior), and licensing — tldraw's "watermark removal" requires a commercial license; check terms.

**Links:** [tldraw.dev](https://tldraw.dev/)

### Excalidraw

**One-sentence what:** A hand-drawn-aesthetic whiteboard, simpler, less extensible than tldraw.

**Relevance:** Beautiful out of the box; not a serious option for *custom interactive widgets on the canvas* — it's a drawing tool, not a workspace platform.

**Links:** [excalidraw.com](https://excalidraw.com/) · [github.com/excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)

### react-konva / Konva

**One-sentence what:** A 2D-canvas React renderer; you draw shapes imperatively but with React's declarative model.

**Relevance:** Use when you want a canvas-only widget (e.g., a fraction bar that drags) and not a full whiteboard. Lighter than tldraw if all you need is "this one manipulable diagram."

**Links:** [konvajs.org](https://konvajs.org/)

### Fabric.js

**One-sentence what:** An older but mature canvas library. Battle-tested, predates the React renderer pattern, often shows up in image-annotation tools.

**Relevance:** Probably not what I'd pick in 2026 for a green-field React app; mention to show I considered it.

### rough.js

**One-sentence what:** A tiny library that draws shapes in a sketchy hand-drawn aesthetic.

**Relevance:** Aesthetic accent — pair with Konva or SVG when I want widgets that *look* like sketches (humanizes the UI, can help learner trust). Not a workspace by itself.

### D3 + SVG

**One-sentence what:** The lingua franca of data-driven manipulable diagrams.

**Relevance:** When the manipulable thing is a chart/graph/function plot rather than a free-form workspace. Combine with [Observable Plot](https://observablehq.com/plot/) for higher-level chart components.

### Math-specific

- **Desmos API** — embeddable graphing calculator. World-class for function plotting; you can listen to expression changes. Free for educational use; needs API key. Excellent demo material.
- **GeoGebra** — geometry + algebra; iframe embed or JS API. Most useful when the learner task is geometric.
- **MathLive** — a formula editor (`<math-field>` web component). Indispensable if you want the learner to *type* math without dropping to LaTeX. Pairs with Mathpix's `mathpix-markdown-it`.

**Links:** [desmos.com/api/v1.10/docs](https://www.desmos.com/api/v1.10/docs) · [wiki.geogebra.org/en/Reference:GeoGebra_Apps_Embedding](https://wiki.geogebra.org/en/Reference:GeoGebra_Apps_Embedding) · [cortexjs.io/mathlive](https://cortexjs.io/mathlive/)

### When do you actually need a freeform canvas?

Almost never, for a 4–6 week prototype with one tightly-scoped learning goal. A *constrained manipulable widget* (drag the fraction bar to match 3/8; rotate the triangle to align with the proof) is more pedagogically sound *and* easier to read mastery signals from than free ink. The freeform canvas is mostly a demo flex. Use it only if your goal genuinely is "the learner writes algebraic steps by hand and the system reads them."

---

## 5. Animation, transitions, "alive but not chaotic"

This is the hardest UX bar in the brief. The brief *explicitly* penalizes "constantly rearranges itself" and "prioritizes animation over comprehension." So the animation strategy has to be a *budget*, not a *style*.

### Motion (formerly Framer Motion)

**One-sentence what:** The dominant React animation library for declarative transitions, layout animations, and gestures.

**Status (verify):** Framer Motion was renamed and partially open-sourced as `motion` / `motion-dom`, with a paid "Motion+" tier for extras. Re-check the install path and current major version before depending on it. Still the default choice in 2026 for "React + nice transitions."

**What to use it for:** Shared-element transitions between scenes (the fraction bar transforms into the next scene's fraction bar), `LayoutGroup` for FLIP animations when something reflows, gesture handlers for drag.

**Links:** [motion.dev](https://motion.dev/)

### View Transitions API

**One-sentence what:** A browser-native API that takes a snapshot of the old DOM, lets you mutate, snapshots the new DOM, and crossfades / morphs between them via CSS.

**Status (verify):** Broadly supported in Chrome and Safari; Firefox shipped support during 2025. Same-document and cross-document variants. For a Next.js / React app, pair with libraries like `next-view-transitions` or React's built-in support.

**Why it matters here:** It's *free* — no JS animation runtime. Shared-element transitions out of the box. Pairs perfectly with the "one structural change at a time" pattern.

**Links:** [developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)

### AutoAnimate

**One-sentence what:** A zero-config animation library — wrap a list container and it animates additions/removals/reorders.

**Relevance:** Useful for "small lists changed" — hint ladder, vocabulary cards. Doesn't help with structural scene changes.

**Links:** [auto-animate.formkit.com](https://auto-animate.formkit.com/)

### GSAP

**One-sentence what:** The veteran imperative animation library, now fully free (the previously-paid plugins were open-sourced when Webflow acquired GSAP — verify, but this happened in 2024).

**Relevance:** Reach for it when motion needs to be cinematic (the "aha moment" celebration, a complex multi-step diagram reveal). Overkill for most state transitions.

**Links:** [gsap.com/docs](https://gsap.com/docs/v3/)

### The principle: an animation budget

The brief's penalty for over-animation is the second-most-important constraint after content correctness. I'll commit to a budget in the writeup, something like:

- **At most one structural change per ~5 seconds** of learner attention.
- **No animation triggered by user input mid-action** (no animating the workspace while the learner is dragging the fraction bar).
- **All transitions ≤300ms,** ideally 150–250ms. The eye stops believing past 400ms.
- **One key visual stays put across a scene change** — that's the anchor the learner uses to reorient. (The brief calls this out: "keep a key visual stable while changing the surrounding guidance.")
- **Motion respects `prefers-reduced-motion`,** because a meaningful fraction of learners are sensitive to motion and you don't want to lose them in week 1.

Material Design 3 and Apple HIG both have good "motion choreography" sections worth skimming for vocabulary (durations, easing curves, "expressive vs. standard" motion).

**Links:** [m3.material.io/styles/motion](https://m3.material.io/styles/motion) · [developer.apple.com/design/human-interface-guidelines/motion](https://developer.apple.com/design/human-interface-guidelines/motion)

---

## 6. State management & UI orchestration

This is the section where I get to defend the "when does the UI change" policy in a single artifact.

### XState

**One-sentence what:** A finite-state-machine / statechart library for JS/TS, with a visual editor (Stately) and a React adapter.

**Why this is uniquely defensible here:** The brief asks me to defend exactly *when* and *why* the UI changes. A statechart is the artifact that *literally* answers that question — it lists every state, every event, every guard, and renders as a diagram I can paste into the writeup. When the CTO asks "what happens if the learner asks for a hint mid-quiz," the answer is a finger pointing at a node on the chart.

**It's also a content-validation gate:** the LLM proposes events; the FSM's guards (`canEnterTransfer`, `canSimplifyWorkspace`) decide whether to accept. The "UI refuses to change automatically" requirement lives in those guards.

**Tradeoff:** Verbose to author, has a learning curve. The cost is real but the payoff (a visual policy artifact) is worth it for this specific brief.

**Links:** [stately.ai/docs/xstate](https://stately.ai/docs/xstate) · [statecharts.dev](https://statecharts.dev/)

### Zustand

**One-sentence what:** A minimal, hooks-based store. Effectively `useState` that survives across components.

**Relevance:** Great for component-level state that doesn't belong in the FSM (e.g. the current ink strokes on the canvas, scratch state for an input field). Use *alongside* XState — XState owns the policy state, Zustand owns the ephemeral UI state.

**Links:** [zustand.docs.pmnd.rs](https://zustand.docs.pmnd.rs/)

### Jotai

**One-sentence what:** Atomic state — primitives compose into derived atoms.

**Relevance:** Similar role to Zustand, different mental model. Pick one, not both. I'd lean Zustand because the simpler model means less to defend.

### Redux Toolkit / RTK Query

**One-sentence what:** The heavyweight, ceremony-heavy option from a previous era. RTK Query is its server-cache addon.

**Relevance:** Don't pick it for a 4–6 week prototype. Mentioned only to say it was considered and rejected (overkill, time-cost).

### TanStack Query

**One-sentence what:** The de-facto server-state cache — fetches, caches, dedupes, revalidates remote data.

**Relevance:** Worth using for the non-streaming server calls (loading the problem bank, persisting learner progress). Pairs cleanly with everything above.

**Links:** [tanstack.com/query/latest](https://tanstack.com/query/latest)

### The composition I'll defend

- **XState** owns the *policy* — scene, learner-state estimate, allowed transitions.
- **Zustand** owns *ephemeral UI state* — ink strokes, hover, transient form fields.
- **TanStack Query** owns *server cache* — problem bank, learner profile, sync.
- The LLM proposes events; the FSM accepts/rejects; React re-renders.

---

## 7. React frameworks

### Next.js 15+ (App Router, RSC)

**One-sentence what:** Vercel's React metaframework — file-based routing, server components, edge runtime, AI-SDK-native.

**Why it surfaces here:** It's the default for AI apps in 2026, the AI SDK was built for it, and Vercel deploys it in ~one click. Server Components handle data fetching well.

**Pain points for this brief:** RSC is awkward for highly interactive, client-state-heavy UIs (which is exactly what the brief wants). Half the workspace will be `"use client"` anyway. Streaming AI responses through RSC has hydration sharp edges.

**Verdict:** Probably the right pick *if* I lean on the AI SDK; otherwise overkill.

**Links:** [nextjs.org/docs](https://nextjs.org/docs)

### Vite + React

**One-sentence what:** A fast bundler + dev server with first-class React support. No SSR by default.

**Relevance:** For a prototype that's a *single very interactive page* (which is what the brief wants), Vite is dramatically simpler than Next.js — no server components, no edge runtime, no hydration mismatches. Pair with a thin Node/Express or Hono backend for the AI proxy.

**Verdict:** Strong candidate. The "we don't need SSR / SEO" argument is fully defensible for a tutoring prototype.

**Links:** [vite.dev](https://vite.dev/)

### Remix / React Router 7

**One-sentence what:** The Remix team's framework merged with React Router; "server-first" data loading model.

**Relevance:** Solid alternative to Next, lighter feel, less Vercel-coupled. Probably not enough upside over Vite for this prototype.

**Links:** [reactrouter.com/start/framework/installation](https://reactrouter.com/start/framework/installation)

### TanStack Start

**One-sentence what:** TanStack's full-stack React framework, on top of TanStack Router and Vinxi/Nitro.

**Status:** Emerging in 2025–2026, stabilizing. Worth a mention as the dark horse for "Vite-feeling SSR." Probably too early to bet a take-home on.

### Verdict

For Nerdy's brief I'd lean **Vite + React + a thin Node/Hono backend** rather than Next.js. The interactivity profile (long-lived workspace, lots of client state, websocket-driven voice) plays to Vite's strengths and doesn't need RSC. If asked to defend choosing Next, the answer is "AI SDK integration"; choosing Vite, the answer is "the interactive surface area dwarfs the route surface area."

---

## 8. Multi-device coordination (optional path)

The brief flags this as *optional* and explicitly requires defending the complexity tax vs. a single-device experience.

### PartyKit

**One-sentence what:** A multiplayer-by-default framework on Cloudflare Durable Objects — write a single "room" server and clients sync to it via WebSocket.

**Relevance:** Easiest path to "phone camera streams handwriting to laptop workspace." Cheap edge-runtime cost.

**Links:** [docs.partykit.io](https://docs.partykit.io/)

### Liveblocks

**One-sentence what:** Hosted collaborative-UI primitives — presence, storage, comments — with React hooks.

**Relevance:** Heavier than PartyKit, more "Figma-style multiplayer" framing. For two devices owned by one learner, overkill.

**Links:** [liveblocks.io/docs](https://liveblocks.io/docs)

### Yjs / CRDTs

**One-sentence what:** A CRDT library for local-first collaborative state — concurrent edits merge without a server arbiter.

**Relevance:** The serious answer if you want offline-tolerant multi-device. Steep learning curve; probably more than the prototype needs.

**Links:** [docs.yjs.dev](https://docs.yjs.dev/)

### WebRTC data channels

**One-sentence what:** Peer-to-peer low-latency data channels between browsers.

**Relevance:** Lowest-latency phone-to-laptop link, no server hop. Painful NAT-traversal and signaling overhead; usually not worth it for a prototype.

### Plain WebSockets

**One-sentence what:** A long-lived bidirectional connection between client and server.

**Relevance:** If the AI backend already maintains a websocket (which it will, for voice), reusing it as the multi-device sync channel is the simplest answer.

### My take

For a 4–6 week prototype, **a single-device tablet experience with voice + stylus + camera-pointing-at-paper** delivers ~90% of the brief's possible delight at ~30% of the complexity. The multi-device path is mostly demo-bait. If I include it, it has to be load-bearing for a specific learning moment ("phone is the camera that watches your paper while your laptop is the workspace") and not just a sensor count.

If I *do* go multi-device, PartyKit is the lowest-friction path.

---

## 9. Content correctness & validation

The brief makes correctness *non-negotiable*. This section is where I get to look serious.

### Deterministic checkers

**One-sentence what:** Code that knows the right answer because *math told it the answer*, not because *an LLM said so*.

- **SymPy** (Python): symbolic algebra system. `sympy.simplify(student_answer - correct_answer) == 0` is a CAS-equivalence check that catches "wrote `2(x+1)` vs `2x+2`" correctly. The canonical tool for grading algebra.
- **`asteval` / Python `ast`** for safe expression eval; `mathjs` in JS for similar.
- For code-domain prompts: AST diff, hidden test cases (the classic competitive-programming approach).

**Why this is the right default:** For a math/algebra prototype, **SymPy + a curated problem bank** is dramatically more defensible than "the LLM checks itself." Every "correct" verdict has a deterministic derivation you can show to a CTO.

**Links:** [docs.sympy.org](https://docs.sympy.org/latest/index.html)

### LLM-as-judge / model critique

**One-sentence what:** Use a second LLM call (or the same one with a different prompt) to grade the first response.

**When it works:** Open-ended explanations, "did the student justify their step," soft rubrics ("does this analogy land for a 7th grader").

**When it lies:** Anything where you could just have computed the answer. Self-consistency is real but bounded — judges score their own family's outputs higher; judges are easily fooled by confident-sounding wrong answers.

**Use it for:** Affect, hint quality, explanation quality. Not for correctness on closed-form problems.

### Constrained generation

**One-sentence what:** Force the model to emit valid JSON conforming to a schema, so downstream code can rely on shape.

- OpenAI: `response_format: { type: "json_schema", json_schema: {...} }` with strict mode.
- Anthropic: tool-use with input schema.
- Gemini: `responseSchema`.
- Open-source: `outlines`, `instructor`, `llguidance`, JSON-schema-guided decoding.

**Why this brief surfaces it:** Every "UIScene" event from the LLM must be schema-valid before it touches the FSM. Constrained outputs + Zod validation are the structural-correctness layer.

**Links:** [platform.openai.com/docs/guides/structured-outputs](https://platform.openai.com/docs/guides/structured-outputs) · [github.com/outlines-dev/outlines](https://github.com/outlines-dev/outlines)

### Retrieval-grounded generation

**One-sentence what:** Have the model answer from a verified content store rather than from training memory.

**Relevance for Nerdy:** Algebra problems are *not* a great RAG target — there's no proprietary corpus to retrieve. But a *curated problem bank with verified solutions* + a retrieval step is essentially RAG with `k=1`, and gives the same guarantee: every problem shown has a known-correct answer that wasn't invented at runtime.

### Eval frameworks

**One-sentence what:** Tools to run prompt variants against fixed test sets and track regression.

- **Braintrust** — hosted, pairs nicely with structured outputs. UI for prompt diffs.
- **LangSmith** (LangChain's offering) — closely tied to LangChain instrumentation.
- **Promptfoo** — open-source, YAML-driven, runs locally. Easiest "I just want to test 10 prompts on 50 cases" path.
- **OpenAI Evals** — open-source, OpenAI-centric.

For the writeup I'll want at minimum a Promptfoo or Braintrust eval suite covering "given learner state X, did the LLM propose the *right* scene transition?" That's a concrete defensible artifact.

**Links:** [braintrust.dev](https://www.braintrust.dev/) · [promptfoo.dev](https://www.promptfoo.dev/) · [docs.langchain.com/langsmith](https://docs.langchain.com/langsmith)

### LangChain (since the portal names it)

**Note:** The portal lists LangChain as a "required" framework. I'll use the JS SDK lightly — probably for retrieval orchestration and the eval harness via LangSmith — but I'll avoid making LangChain the spine of the agent. The community moved decisively in 2024–2025 toward LangGraph for stateful agents *and* toward thinner frameworks; either an FSM (XState) or LangGraph is more defensible than vanilla LangChain chains. If asked to defend, "we use LangChain's `langchain-openai` provider abstractions and LangSmith for tracing; XState handles the actual policy" is honest and clean.

**Links:** [js.langchain.com](https://js.langchain.com/docs/introduction/) · [langchain-ai.github.io/langgraph](https://langchain-ai.github.io/langgraph/)

---

## 10. Mastery models & adaptive testing (educational measurement)

This is a real research field. Borrow from it instead of inventing.

### Bayesian Knowledge Tracing (BKT)

**One-sentence what:** Model each skill as a hidden binary latent ("learner knows it" or not); update the posterior after each item using four parameters (P(initial-knowledge), P(transit), P(slip), P(guess)).

**Why this brief surfaces it:** It's interpretable. Khan Academy's mastery system is BKT-derived; "knowledge state" is a probability you can show the learner ("87% confident you've got this"). The original paper is Corbett & Anderson 1995.

**Tradeoff:** Coarse — one bit per skill, no item-difficulty estimate. Underestimates partial credit.

**Links:** Corbett & Anderson 1995 — ["Knowledge tracing: Modeling the acquisition of procedural knowledge"](https://link.springer.com/article/10.1007/BF01099821) · [Khan Academy R&D mastery / learning analytics writeups](https://blog.khanacademy.org/)

### Deep Knowledge Tracing (DKT)

**One-sentence what:** Replace the BKT HMM with an LSTM/transformer that takes the learner's interaction sequence and predicts next-item correctness.

**Tradeoff:** More accurate than BKT in published benchmarks; harder to interpret ("the model thinks you're 87% likely to get the next item right, but I can't tell you which sub-skill is shaky"). Piech et al. 2015 is the seminal paper.

**Links:** Piech et al. 2015 — ["Deep Knowledge Tracing"](https://stanford.edu/~cpiech/bio/papers/deepKnowledgeTracing.pdf) · TensorFlow is the portal-allowed framework that natively fits DKT.

### Item Response Theory (IRT)

**One-sentence what:** Psychometric model where each item has a "difficulty" parameter and each learner an "ability" parameter; P(correct) is a function of (ability − difficulty).

**Why this brief surfaces it:** It's the right answer to "how do I know the next item I show is *appropriately* hard?" — that's IRT-adaptive testing in a nutshell (the GRE, SAT, NAEP all use IRT-derived models).

**Tradeoff:** Needs item calibration data to estimate difficulties. For a 4–6 week prototype, you'll bootstrap with model-suggested difficulties or hand-labels.

**Links:** ["Item Response Theory: A Practical Guide" (de Ayala)](https://www.guilford.com/books/The-Theory-and-Practice-of-Item-Response-Theory/Rafael-de-Ayala/9781462547753) is the standard text. For a friendlier intro: [Frank Baker — "The Basics of Item Response Theory"](http://echo.edres.org:8080/irt/baker/) (free online).

### Elo-like rating systems

**One-sentence what:** Treat each learner-item interaction as a "match"; update both ratings after each one.

**Why this brief surfaces it:** This is the pragmatic shortcut. Pelánek (2016) showed Elo-on-skills works competitively with BKT/IRT and is dramatically simpler to implement. Several adaptive learning systems (Math Garden, Duolingo's earlier system) have used Elo variants.

**Links:** Pelánek 2016 — ["Applications of the Elo rating system in adaptive educational systems"](https://www.sciencedirect.com/science/article/pii/S0360131516301142)

### Transfer-task design

The brief *requires* at least one transfer moment. What makes a transfer item actually transfer?
- **Different surface, same deep structure** — change the cover story or representation; keep the underlying operation (Bransford & Schwartz on "preparation for future learning").
- **Less scaffolding** — no manipulable, no hint ladder, no visual aid.
- **Novel composition** — combine two sub-skills the learner mastered separately.

**Links:** Bransford & Schwartz 1999 — ["Rethinking Transfer: A Simple Proposal With Multiple Implications"](https://psycnet.apa.org/record/1999-13167-001) (Review of Research in Education).

### False-positive defenses

The brief specifically calls these out:
- **Response-time distributions:** too-fast = guessing or pattern-matching. Compare against the expected solve-time distribution for that item.
- **Confidence elicitation:** ask the learner "how sure?" before the answer; high-confidence wrong is a real signal.
- **Explain-back tasks:** "say that back in your own words"; cheap with the voice channel, hard to fake.
- **Interleaved practice (vs. blocked):** mixing items across skills prevents the rote-pattern shortcut. Rohrer & Taylor showed this in 2007.
- **Spacing:** if the learner can do it today *and* in three days, that's evidence; if only today, it's working memory.

**Links:** Rohrer & Taylor 2007 — ["The shuffling of mathematics problems improves learning"](https://link.springer.com/article/10.1007/s11251-007-9015-8) · ASSISTments open data: [sites.google.com/site/assistmentsdata/](https://sites.google.com/site/assistmentsdata/)

### What I'll actually use

For the prototype: **BKT or a single-skill Elo + response-time gating + at least one explain-back transfer item.** I can defend each piece against a published reference. DKT in TensorFlow would *check the portal's TensorFlow box* but I'd have to be honest that it's overkill for a single-skill prototype — only worth it if I extend to multi-skill.

---

## 11. Observability & eval infra

For a 4–6 week prototype with a "defend your metrics" expectation:

### PostHog

**One-sentence what:** Product analytics + session replay + feature flags, self-hostable.

**Why it's load-bearing here:** Session replay is *invaluable* for the "did the UI churn too much" question. The brief asks counter-metrics like "did the UI change too often" — you can literally watch the replays. Pair with custom events for every scene transition.

**Links:** [posthog.com/docs](https://posthog.com/docs)

### OpenTelemetry

**One-sentence what:** Vendor-neutral tracing/metrics/logs standard; LLM calls plug in via the `genai` semantic conventions.

**Relevance:** Trace one learner turn end-to-end — voice in, model call, FSM transition, UI scene mount. Use OTel + Honeycomb / Grafana Tempo / Langfuse for the backend; the AI SDK has OTel hooks.

**Links:** [opentelemetry.io/docs](https://opentelemetry.io/docs/) · [opentelemetry.io/docs/specs/semconv/gen-ai/](https://opentelemetry.io/docs/specs/semconv/gen-ai/)

### Braintrust / LangSmith / Langfuse

LLM eval pipelines (see §9). Pick one. Braintrust if I want polished UX; Langfuse if I want self-hostable + free.

**Links:** [langfuse.com/docs](https://langfuse.com/docs)

### Sentry

Error tracking — table stakes. [sentry.io](https://sentry.io/)

---

## 12. Deployment & infra

The portal requires AWS or GCP. There are realistic shortcuts.

### Vercel

**One-sentence what:** Hosted Next.js (and friends) — zero-config deploys, edge functions, AI SDK integration.

**The portal-compliance trick:** Vercel runs on AWS under the hood (us-east-1 primarily). "Deployed on AWS via Vercel" is *truthful* and ships in 10 minutes. Worth knowing as the fast path if I do pick Next.js. The CTO won't be confused by this; explicitly call it out in the writeup.

**Tradeoff:** Vendor coupling. Function timeouts (60s/300s tier-dependent) bite long voice sessions — use WebSocket-friendly infra for the realtime layer.

**Links:** [vercel.com/docs](https://vercel.com/docs)

### Cloudflare Workers + Pages

**One-sentence what:** Edge compute on Cloudflare's global network; cheapest at scale.

**Relevance:** Great for the lightweight "router" parts (auth, problem-bank fetch). Painful for Python (Workers Python is beta-ish) and for long-lived realtime sockets except via Durable Objects. *Not* on the portal's allowed list — disqualifying for compliance.

### AWS direct

- **App Runner** — closest to "push container, get HTTPS." Easy compliance answer.
- **ECS Fargate** — more control, more YAML.
- **Amplify** — Vercel-lite; good for the React frontend.
- **API Gateway + Lambda** — fine for short calls; awkward for long voice sessions (Lambda's 15-min limit and no native WebSocket termination — you'd use API Gateway WebSocket, which is fiddly).

**Verdict if I go direct AWS:** App Runner for the API + S3/CloudFront for the static React build is the lowest-ceremony shape.

**Links:** [docs.aws.amazon.com/apprunner](https://docs.aws.amazon.com/apprunner/)

### GCP Cloud Run

**One-sentence what:** App Runner's equivalent — push container, get HTTPS, scale to zero.

**Relevance:** Equally fine. Pick AWS if I want broad familiarity; GCP if I want better default Python / ML tooling integration.

**Links:** [cloud.google.com/run/docs](https://cloud.google.com/run/docs)

### Fly.io / Render

Convenient and great for prototypes — not in the portal's allowed list, so out for compliance. Mention only as "considered, rejected on portal compliance."

### Recommended deploy shape

- **Frontend:** Vite build → S3 + CloudFront, *or* Vercel (running on AWS).
- **AI gateway / FSM server:** Node (Hono) on App Runner, or Python (FastAPI for SymPy + DKT) on App Runner.
- **Voice realtime:** browser → directly to OpenAI/Gemini Realtime via ephemeral tokens minted server-side (no need to proxy audio through your own infra; cheaper, lower latency).
- **State:** RDS Postgres (or Neon) for learner profiles + interaction logs; S3 for camera frames.

---

## Cross-cutting reading list

Seminal references — skim these and you'll have most of the vocabulary the CTO will use.

1. **Sutton & Barto — *Reinforcement Learning: An Introduction* (2nd ed.).** Frame adaptive policies as RL even when you're not training one. Free PDF: [incompleteideas.net/book/the-book-2nd.html](http://incompleteideas.net/book/the-book-2nd.html)
2. **Anderson — ACT-R / Cognitive Tutor papers.** The original mastery-learning systems; "what does mastery mean" got its operational answer here. Start with Anderson, Corbett, Koedinger, Pelletier (1995) — ["Cognitive Tutors: Lessons Learned"](http://act-r.psy.cmu.edu/wordpress/wp-content/uploads/2012/12/167CT_lessons_learned.pdf).
3. **Wieman / Deslauriers et al. — Active Learning.** Deslauriers et al. 2019 ("Measuring actual learning vs. feeling of learning") is the one to cite — learners *feel* worse in active classes but score better. Directly relevant to false-positive mastery. [PNAS](https://www.pnas.org/doi/10.1073/pnas.1821936116).
4. **Khan Academy R&D writeups on BKT.** The clearest applied BKT material that's not paywalled. Start at [blog.khanacademy.org](https://blog.khanacademy.org/) and search "mastery."
5. **Andy Matuschak — "How can we develop transformative tools for thought?"** The single most relevant tools-for-thought essay for this brief. [numinous.productions/ttft](https://numinous.productions/ttft/) (with Michael Nielsen). Also his "spaced repetition memory system" writeups.
6. **Maggie Appleton — "Tools for Thought" essays.** [maggieappleton.com](https://maggieappleton.com/) — vocabulary for "epistemic interfaces" that the brief implicitly demands.
7. **Linus Lee — generative-interface essays.** [thesephist.com](https://thesephist.com/) — he's been thinking publicly about LLM-driven interfaces longer than almost anyone.
8. **Anthropic — Tool use & structured outputs docs.** [docs.anthropic.com/en/docs/build-with-claude/tool-use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use) — even if I default to OpenAI, the Anthropic write-up explains the conceptual model more clearly.
9. **OpenAI — Structured Outputs guide.** [platform.openai.com/docs/guides/structured-outputs](https://platform.openai.com/docs/guides/structured-outputs) — the JSON-schema strict-mode is the foundation of my UIScene contract.
10. **Nielsen Norman Group — Cognitive Load + UI Stability.** [nngroup.com/articles/minimize-cognitive-load](https://www.nngroup.com/articles/minimize-cognitive-load/) and their "change blindness" pieces. Cite when defending the animation budget.
11. **Pelánek 2017 — "Bayesian Knowledge Tracing, Logistic Models, and Beyond."** A clean comparative paper across the mastery-modeling family. [link.springer.com/article/10.1007/s11257-017-9193-2](https://link.springer.com/article/10.1007/s11257-017-9193-2)
12. **Soderstrom & Bjork 2015 — "Learning Versus Performance."** Performance during practice ≠ learning. The single best citation for "the learner felt fluent but didn't actually learn." [Perspectives on Psychological Science](https://journals.sagepub.com/doi/10.1177/1745691615569000).
