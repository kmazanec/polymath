# Voice cross-platform smoke checklist

Scripted manual test checklist for the voice affordance (AskTutorButton / LiveKit
Realtime integration). Run this with real LiveKit and OpenAI Realtime credentials
in a deployed or docker-compose environment. All boxes are **UNCHECKED** — these
tests are pending a human tester with real devices and keys.

---

## Setup

### Environment variables required

| Variable | Description |
|---|---|
| `LIVEKIT_URL` | WebSocket URL for your LiveKit Cloud project, e.g. `wss://my-project.livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit API key (from the LiveKit Cloud dashboard) |
| `LIVEKIT_API_SECRET` | LiveKit API secret (from the LiveKit Cloud dashboard) |
| `OPENAI_API_KEY` | OpenAI API key with access to the Realtime API (`gpt-realtime`) |

Set these in `.env` (copy from `.env.example`) before running `docker compose up --build`.

### Verification that the stack is live

1. `./infra/smoke.sh` passes (health, session, WS round-trip checks).
2. `curl -s http://localhost:8080/api/health` returns `{"status":"ok"}`.
3. Navigate to `http://localhost:8080` (or the production URL) and confirm the
   lesson workspace loads.

---

## Platform matrix

Run the full checklist below on each of the five platforms listed. Check each box
as it passes; record failures with a short note in the results table at the end.

### Platform: Chrome desktop (macOS or Windows, latest stable)

- [ ] **Permission timing** — on page load, no mic permission dialog appears;
  the browser does NOT prompt for microphone access until the user clicks
  "Ask the tutor".
- [ ] **Token mint** — clicking "Ask the tutor" shows "Connecting…" within 500ms;
  the network tab shows a `POST /api/realtime/session` returning 201.
- [ ] **Voice session establishes** — within 3s the button label changes to
  "Listening…" and the tutor can hear audio (confirm via the LiveKit Cloud
  participant panel or OTel trace).
- [ ] **Audible tutor response TTFT** — after asking a short question (e.g. "what
  does an AND gate do?"), the tutor's spoken response begins within ~1s of the
  last word of the question.
- [ ] **Learner transcript** — the tutor's response text appears in the session
  events or transcript area of the UI within ~2s of the audio starting.
- [ ] **Barge-in** — while the tutor is speaking a long answer, interrupting with
  speech stops the tutor's audio within ~300ms; the tutor does not resume the
  interrupted utterance.
- [ ] **Token refresh** — leave the session open for at least 5 minutes and 30
  seconds; confirm no disconnect occurs at the 5-minute boundary (check the
  browser console and OTel traces for a seamless token swap).

### Platform: Firefox desktop (latest stable)

- [ ] **Permission timing** — no mic prompt on page load; prompt appears only on
  click of "Ask the tutor".
- [ ] **Token mint** — `POST /api/realtime/session` returns 201 after click.
- [ ] **Voice session establishes** — "Listening…" label within 3s.
- [ ] **Audible tutor response TTFT** — spoken response begins within ~1s.
- [ ] **Learner transcript** — transcript appears within ~2s.
- [ ] **Barge-in** — tutor audio stops within ~300ms of interruption.
- [ ] **Token refresh** — seamless across the 5-minute boundary.

### Platform: Safari desktop (macOS, latest stable)

> **Risk note (from ADR-006):** Safari has historically been stricter about
> microphone permission persistence across page loads. On macOS, Safari may
> re-prompt on every load rather than remembering a prior grant; this is expected
> behaviour and not a bug in the app. The key assertion is that the *first* prompt
> does not appear before the user gesture.

- [ ] **Permission timing** — no mic prompt on page load; prompt appears only on
  click of "Ask the tutor" (first run; subsequent runs may prompt again due to
  Safari's permission-persistence model).
- [ ] **Token mint** — `POST /api/realtime/session` returns 201 after click.
- [ ] **Voice session establishes** — "Listening…" label within 3s.
- [ ] **Audible tutor response TTFT** — spoken response begins within ~1s.
- [ ] **Learner transcript** — transcript appears within ~2s.
- [ ] **Barge-in** — tutor audio stops within ~300ms of interruption.
- [ ] **Token refresh** — seamless across the 5-minute boundary.

### Platform: Chrome on Android (latest stable, physical device or BrowserStack)

- [ ] **Permission timing** — no mic prompt on page load; Android system permission
  dialog appears only after tapping "Ask the tutor".
- [ ] **Token mint** — `POST /api/realtime/session` returns 201 after tap.
- [ ] **Voice session establishes** — "Listening…" label within 3s.
- [ ] **Audible tutor response TTFT** — spoken response begins within ~1s (allow
  up to 2s on slower mobile networks).
- [ ] **Learner transcript** — transcript appears within ~2s.
- [ ] **Barge-in** — tutor audio stops within ~300ms of interruption.
- [ ] **Token refresh** — seamless across the 5-minute boundary.

### Platform: Safari on iOS (latest stable, physical device or BrowserStack)

> **Risk note (from ADR-006):** iOS Safari has well-documented autoplay-audio
> policy and microphone permission quirks:
>
> - **Autoplay:** iOS requires a prior user gesture before an `<audio>` element
>   can play. The LiveKit default connector creates an `<audio autoplay>` element;
>   on iOS this element may be silently blocked until the user interacts again.
>   Mitigation: confirm audio plays by speaking to the tutor immediately after
>   connecting; if silent, tap the screen once and try again.
> - **Permission persistence:** iOS Safari does not persist microphone permissions
>   across sessions by default. Expect the iOS permission sheet to appear on every
>   cold load (different from desktop Chrome's cached grant); this is iOS policy,
>   not a bug. The assertion is only that the sheet does NOT appear before the
>   first tap of "Ask the tutor".
> - **WebRTC reliability:** iOS WebRTC via WebKit can be sensitive to tab
>   backgrounding. Test with the app in the foreground for the full duration.

- [ ] **Permission timing** — no iOS mic permission sheet on page load; sheet
  appears only after tapping "Ask the tutor".
- [ ] **Token mint** — `POST /api/realtime/session` returns 201 after tap.
- [ ] **Voice session establishes** — "Listening…" label within 4s (allow 1s extra
  for iOS WebRTC ICE negotiation).
- [ ] **Audible tutor response plays** — the tutor's audio is audible (if silent,
  tap the screen once to satisfy the iOS autoplay policy, then recheck).
- [ ] **Audible tutor response TTFT** — spoken response begins within ~1–2s.
- [ ] **Learner transcript** — transcript appears within ~2s.
- [ ] **Barge-in** — tutor audio stops within ~300ms of interruption (iOS VAD may
  have slightly higher latency; ~500ms is acceptable on iOS Safari).
- [ ] **Token refresh** — seamless across the 5-minute boundary; confirm the app
  stays in the foreground for the full test duration.

---

## Results table

Fill in after running the checklist. Leave blank before testing.

| Platform | Pass / Fail | Notes |
|---|---|---|
| Chrome desktop | | |
| Firefox desktop | | |
| Safari desktop | | |
| Chrome on Android | | |
| Safari on iOS | | |

---

## Caddy / networking

**No Caddy changes are required** for the voice feature.

The token-mint endpoint (`POST /api/realtime/session`) lives under the `/api/*`
path prefix. Both Caddy configs already route `/api/*` to the agent service:

- `ops/polymath.caddyfile` — `handle /api/* { reverse_proxy polymath-agent:8080 }`
- `infra/caddy/polymath.caddyfile` — `handle /api/* { reverse_proxy agent:8080 }`

The new endpoint is therefore covered by the existing rule in both environments.
No new `handle` block, matcher, or header directive is needed.

**WebRTC media is direct browser-to-LiveKit-Cloud** — it does not traverse Caddy
at all. The browser opens a WebRTC connection directly to the LiveKit Cloud
endpoint (`LIVEKIT_URL`) using ICE/DTLS; Caddy only sees the token-mint HTTP
request (one round-trip per session start / token refresh). All audio data
bypasses the Caddy reverse proxy entirely.
