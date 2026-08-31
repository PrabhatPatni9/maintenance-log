# Ratanmoti Maintenance

Internal PWA for recording loom maintenance at Ratanmoti Texfab. Operators speak
a note in Hindi, Marathi or English. The app transcribes it live, detects which
maintenance actions and parts were mentioned, and stores an immutable record
against a specific machine in a specific shed.

Not a public product. Ratanmoti only.

---

## Read in this order

| File | What it holds |
|---|---|
| `CLAUDE.md` | The authoritative spec. Architecture, data model, capture flow, non-negotiables. |
| `AGENTS.md` | How agents work in this repo. Commands, conventions, deploy runbook. |
| `DESIGN.md` | Visual and interaction spec. |
| `PROMPTS.md` | Phase by phase build prompts. Feed these to the coding agent one at a time. |
| `docs/whisper-vps.md` | Setting up the self hosted transcription service on KVM4. |

---

## How it works in one paragraph

Transcription happens in the browser using the Web Speech API, which is free,
real time, and needs no key or account. It needs internet, so audio is always
captured in parallel and queued in IndexedDB. Anything the browser could not
transcribe is picked up by a self hosted Whisper service on Ratanmoti's own KVM4
VPS. Structured data comes from regex matching the transcript against a
controlled vocabulary whose synonym lists carry both Devanagari and Latin forms,
so no transliteration code is needed. Storage is R2, which at roughly 90 KB per
recording sits far inside the 10 GB free allowance.

No hosted AI API is called anywhere in the pipeline. No LLM, no paid tier, no
third party model provider. Set `STT_MODE` to `local_only` and even the browser
engine is bypassed, putting every transcription on hardware Ratanmoti owns.

Total running cost: zero, beyond the VPS that was already running.

---

## Setup order

1. Expand `data/taxonomy.seed.json` with the shed supervisor. This is an hour of
   work and it determines whether the structured data is worth anything.
2. Take a phone into a running shed and test the Web Speech API against real
   operator speech and real loom noise. This validates or breaks the whole
   architecture, so do it before phase 3.
3. Run `PROMPTS.md` phases 0 through 5 with a coding agent.
4. Stand up the Whisper service on KVM4 per `docs/whisper-vps.md`.
5. Hand the Cloudflare setup to Manus, following the runbook in `AGENTS.md`.

Do not skip steps 1 and 2. They are the only parts nobody can do for you.

---

## Stack

React 19, Vite, TanStack Router, Dexie, vite-plugin-pwa on the front.
Hono on Cloudflare Workers with D1, R2 and KV on the back. Workers Static Assets
serves both from one deploy at `maintenance.ratanmoti.in`.

Everything runs on free tiers. If a change requires a paid plan, it does not
ship. See `CLAUDE.md` section 2.
