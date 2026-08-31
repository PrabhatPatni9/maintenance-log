# CLAUDE.md

Authoritative build document for **Ratanmoti Maintenance**. Any coding agent working
in this repo reads this file first, then `AGENTS.md`, then `DESIGN.md`.

If something in this file conflicts with a chat instruction, this file wins unless
the human explicitly says "update CLAUDE.md".

---

## 1. What this is

An internal PWA for Ratanmoti Texfab that records what maintenance was done on
every loom, in every shed, by whom, and when.

Operators speak a note in Hindi, Marathi or English. The app transcribes it live,
auto-detects which maintenance actions and parts were mentioned, shows them as
pills the operator confirms, and stores an immutable record.

Not a public product. Not multi-tenant. Ratanmoti only.

### Success is measured by one thing

An operator with oily hands, standing next to a running rapier loom, in a shed
with patchy 4G, can file an accurate log in under 40 seconds without asking
anyone for help. Every architectural decision defers to that.

---

## 2. Non-negotiables

These are decisions already made. Do not relitigate them in code.

1. **Recording never depends on the network.** The mic opens instantly. Audio
   lands in IndexedDB before anything is sent anywhere.
2. **The 45 second timer is a lie in the operator's favour.** The UI counts down
   from 45. Capture actually runs to 50 seconds. See section 6.
3. **No log is ever lost.** If sync fails, the log stays queued on the device and
   retries. The queue survives app close, phone restart and browser cache clears
   (IndexedDB, not localStorage).
4. **Approved logs are immutable.** Only an admin can change an approved log, and
   every change appends to `log_edits`. Nothing is overwritten in place.
5. **Keyword matching is regex against a synonym list.** No transliteration
   engine, no fuzzy matching library, no ML on device. The complexity lives in
   the taxonomy data, not the code. See section 8.
6. **Everything free, and no third party AI.** No paid Cloudflare plan, no
   hosted AI API, no LLM call anywhere in the request path. Transcription is
   either the browser's own engine or Whisper running on hardware Ratanmoti
   already pays for. Structuring is regex. If a feature seems to need a hosted
   model, it does not ship. Flag it to the human instead of adding it.
7. **Three languages are equal.** Hindi, Marathi and English are peers. There is
   no "default with translations bolted on". Every string exists in all three
   before a screen is considered done.

---

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite + TanStack Router | Known stack, small bundle |
| PWA | `vite-plugin-pwa` (Workbox) | Install prompt, offline shell |
| Local store | IndexedDB via `dexie` | Survives restart, holds audio blobs |
| API | Hono on Cloudflare Workers | Free tier, already familiar |
| Static assets | Workers Static Assets (`assets` in wrangler) | One deploy, one domain, no Pages split |
| DB | Cloudflare D1 | 5 GB free, plenty |
| Audio | Cloudflare R2 | 10 GB free recurring, zero egress |
| Sessions | Cloudflare KV | Cheap reads at the edge |
| Live STT | Web Speech API (browser) | Free, real time, no key, no account |
| Fallback STT | faster-whisper, self hosted on KVM4 | Handles queued offline audio only. No third party API. |
| Structuring | Regex against the taxonomy | No LLM anywhere in the pipeline |

### Cloudflare account

Deploy under the account tied to `prabhatpatni9@gmail.com`, which holds the
`ratanmoti.in` zone. Worker custom domains require the zone to live in the same
account, so this is the only account where `maintenance.ratanmoti.in` will bind
without workarounds.

Resources to create in that account:

- D1 database: `ratanmoti-maintenance`
- R2 bucket: `ratanmoti-maintenance-audio`
- KV namespace: `SESSIONS`
- Worker: `ratanmoti-maintenance`
- Custom domain: `maintenance.ratanmoti.in`

---

## 4. Repo layout

```
/
  CLAUDE.md            this file
  AGENTS.md            agent operating rules and commands
  DESIGN.md            visual and interaction spec
  PROMPTS.md           phased build prompts
  wrangler.jsonc
  package.json
  /src
    /worker            Hono API. Entry: src/worker/index.ts
      /routes          auth.ts, sheds.ts, machines.ts, logs.ts, admin.ts
      /lib             db.ts, auth.ts, r2.ts, stt/
      /stt             index.ts (provider interface), whisper.ts, stub.ts
    /web               React PWA. Entry: src/web/main.tsx
      /routes
      /components
      /lib             db.ts (dexie), queue.ts, speech.ts, match.ts
      /i18n            en.json, hi.json, mr.json
    /shared            types.ts, taxonomy.ts  (imported by both sides)
  /migrations          D1 migrations, numbered
  /data                taxonomy.seed.json
  /.github/workflows   deploy.yml
```

`/src/shared` is the contract. If a type is used by both the Worker and the web
app, it lives there and nowhere else.

Two files already exist as reference implementations. They are the two trickiest
pieces and their comments explain why each behaviour is there. Extend them, do
not rewrite them from scratch.

- `src/web/lib/speech.ts` : Web Speech wrapper, restart and fallthrough handling
- `src/shared/match.ts` : the transcript to taxonomy matcher

---

## 5. Data model

Full DDL is in `migrations/0001_init.sql`. Shape and intent:

- **`users`** keyed by `phone`. Roles are `admin` and `operator`. No self signup.
  An admin creates every account.
- **`sheds`** and **`machines`**. `machines` carries a `shedview_id` column.
  Populate it from day one so loom stop data from ShedView can be joined against
  maintenance history later. Retrofitting this mapping is painful.
- **`logs`** is one maintenance event on one machine by one operator.
- **`log_segments`** is one 50 second recording. A log has one or more. This is
  what makes "record more" work without losing anything.
- **`log_items`** is the structured output: the confirmed action and part codes.
  This table is what every future report reads from.
- **`log_edits`** is the append only admin audit trail.
- **`taxonomy_items`** and **`taxonomy_synonyms`** hold the controlled vocabulary.

### Status flow for `logs`

```
draft ──► pending_transcription ──► awaiting_review ──► approved
              │                            │
              └──────► failed ◄────────────┘
```

`draft` exists only on the device. The server never sees it. A log arrives at
the server already at `awaiting_review` if Web Speech handled it, or at
`pending_transcription` if only audio came through.

---

## 6. The capture flow

This is the heart of the product. Build it exactly as specified.

### Entry

Operator taps **Record a log**. Before recording, they pick a machine, either by
scanning the QR sticker on the loom or from a searchable picker grouped by shed.
The machine is chosen first so the app never has to parse a machine number out of
speech. Do not attempt spoken machine number extraction.

### Recording a segment

The moment the mic permission resolves, both of these start together:

- `MediaRecorder` writing Opus at 24 kbps mono into memory
- `SpeechRecognition` with `lang` set from the operator's chosen app language
  (`hi-IN`, `mr-IN`, `en-IN`) and `interimResults: true`

The UI shows a 45 second countdown. Capture continues to **50 seconds**.

The final 5 seconds are the grace tail. The operator sees the ring complete at 45
and reads "wrapping up", but audio and recognition keep running to 50. If they
looked away and started talking at second 42, nothing is lost. This is the whole
point of the design, so do not "fix" the mismatch by making capture 45 seconds.

Hard stop at 50 seconds. There is also a **Stop** button; most segments will be
15 to 25 seconds and the operator should never be forced to wait out the clock.

### Why 50 and not 60

Chrome's `SpeechRecognition` silently fires `onend` around the 60 second mark.
Fifty keeps every segment comfortably inside that window. Even so, wire an
automatic restart inside `onend` and swallow the `no-speech` error that fires
when someone pauses. Every team that skips this ships a recorder that dies
mid-sentence.

### After a segment

The transcript appears. The offline matcher runs and pre selects pills. The
operator sees:

- the transcript, editable as plain text
- pills for detected actions and parts, already selected
- **Add more** to record another 50 second segment appended to the same log
- **Done** to move to review

Segments are unlimited. Each one stores its own audio blob and its own
transcript, joined for display. The operator keeps going until they are happy.

### If Web Speech is unavailable or returns nothing

Do not show an error. Silently fall through:

1. Audio is already captured. Queue it with `source: 'server'`.
2. Show "Saved. Text will appear once you are back in range."
3. Offer the typed note box immediately so they can proceed now if they want.

The operator should not be able to tell whether transcription happened on device
or on the server. It is the same screen either way.

### Review and approve

Operator sees the full transcript and pill set in their chosen language, taps
**Approve**. Log locks. That is the whole review step. Do not add a confirmation
dialog on top of it.

---

## 7. Offline sync

Use a single outbox table in IndexedDB. Each row is a complete log with its
segments and audio blobs.

Rules:

- Log IDs are generated on the device (UUIDv7). The server accepts the client ID
  as the primary key. This makes retries idempotent for free.
- Upload order: create the log row, then upload each segment's audio to R2 via a
  presigned PUT, then mark the log synced. Partial failure retries only the
  failed parts.
- Retry with exponential backoff, capped at 5 minutes. Never drop a row.
- Use the Background Sync API where available, and a plain online listener plus
  an interval as the fallback for iOS.
- The queue count is always visible in the header. An operator with 3 pending
  logs should be able to see that at a glance.

Never block the UI on sync. Never show a spinner that waits on the network.

---

## 8. The taxonomy and the matcher

### The taxonomy is the most valuable artifact in this project

It is what turns "oil change kiya" into a row you can count. Reports, mean time
between failures, parts consumption, and recurring fault detection all read from
`log_items`, which only exists because the taxonomy exists.

`data/taxonomy.seed.json` is a starting point written from general rapier loom
knowledge. It is **not** correct for Ratanmoti yet. Expanding it with the shed
supervisor is a task for the human, not the agent. The agent's job is to make
expansion trivial: an admin screen where a new item and its synonyms can be added
in under a minute.

### Matching rule

For each taxonomy item, hold a synonym list. Match by building one case
insensitive regex per item with word boundaries, and testing it against the
normalised transcript. First match wins, order does not matter, one item can
match once per log.

Normalisation is limited to: lowercase, collapse whitespace, strip punctuation.
Nothing else.

### The one thing that makes plain regex work

**Every synonym list must contain both scripts.** Web Speech returns Devanagari
for `hi-IN` and `mr-IN`, and Latin for `en-IN`. The same operator saying the same
thing produces `तेल बदलले` on one setting and `oil change` on another.

So `OIL_CHANGE` carries `oil change`, `oil chng`, `तेल बदल`, `तेल बदलले`,
`ऑइल चेंज`, `oil daala` and so on, all in one flat list.

This is why no transliteration code is needed. The complexity moved into the
data, where a supervisor can fix it without a deploy. When a match is missed in
the field, the fix is adding a synonym, not shipping code.

### Pills

Matched items render as selected pills. Tapping a pill deselects it. A
**+ Add** button opens a searchable list of the full taxonomy in the operator's
language for anything the matcher missed. Every pill stores `origin` as `auto` or
`manual` so match quality can be measured later.

---

## 9. Auth

Phone number is the unique ID. Phone plus password. No OTP, no SMS cost.

### The CPU constraint

Workers on the free plan allow 10 ms CPU per request. A server side PBKDF2 at
sensible iteration counts will exceed that and the login will fail.

So: derive on the client. The browser runs PBKDF2-SHA256, 150k iterations, over
the password with a per user salt fetched by phone number. It sends the derived
key. The server does one SHA-256 over that and compares against `pass_hash`.

This means the derived key is password equivalent in transit and relies on TLS.
For an internal tool on a company subdomain that is an acceptable trade. Write it
in a comment where it happens so nobody "fixes" it later without understanding
the constraint.

### Sessions

JWT in an httpOnly, Secure, SameSite=Lax cookie. 90 day expiry. Session record in
KV so an admin can revoke. Operators should log in roughly never.

---

## 10. Language

Language is chosen on first launch, before login, on a three button screen. Stored
in `localStorage` and on the user record once they log in.

- `en.json`, `hi.json`, `mr.json` in `src/web/i18n`
- No string literals in components. Ever.
- The language choice also sets `SpeechRecognition.lang` and the pill labels
- A **change language** control lives in settings, one tap, no reload

Machine numbers and dates render with tabular numerals in Latin digits in all
three languages. Operators read machine numbers off metal plates in Latin digits;
rendering `१२` when the loom says `12` is a bug, not localisation.

---

## 11. Server side transcription

Only handles queued audio that Web Speech did not cover. Runs on Ratanmoti's own
KVM4 VPS. No third party API is called at any point.

### Where the audio actually goes

Two paths, and only two:

1. **Web Speech**, which is Chrome's built in engine. On Android this is
   server based, so that audio does reach Google the same way Gboard voice
   typing does. Nothing is stored by the app on that path.
2. **Whisper on KVM4**, which is entirely inside Ratanmoti's own infrastructure.

If path 1 is unacceptable for any reason, set `STT_MODE` to `local_only`. The
app then never calls `SpeechRecognition` at all: every segment is recorded,
queued, and transcribed by Whisper on the VPS. The trade is that live transcript
disappears and results arrive seconds later instead of instantly. The UI already
handles that case because it is the same code path as offline capture, so the
switch is a config change with no code change.

`STT_MODE` values:

| Value | Behaviour |
|---|---|
| `hybrid` | Default. Web Speech live, Whisper for anything it missed. |
| `local_only` | No Web Speech. Everything transcribed on KVM4. |

### Provider interface

`src/worker/stt/index.ts`:

```ts
export interface SttProvider {
  transcribe(audio: ArrayBuffer, hint: Lang): Promise<{
    text: string;
    detectedLang: Lang;
    confidence?: number;
  }>;
}
```

Two implementations: `whisper.ts` (posts to the KVM4 endpoint) and `stub.ts`
(returns a fixed string when no endpoint is configured, for local dev). Selected
by `STT_PROVIDER`. Adding a provider must never require touching a route.

### The KVM4 service

Setup runbook is in `docs/whisper-vps.md`. In short: `faster-whisper` with
`large-v3` at int8 behind a small FastAPI wrapper with bearer token auth,
exposed through the Cloudflare tunnel that already runs on that box.

Two constraints the Worker code must respect:

- **It is slow and that is fine.** On four CPU cores a 50 second clip takes
  roughly 60 to 100 seconds. This is a queue, not a request. Never make a user
  facing route wait on it.
- **Concurrency is 1.** KVM4 already carries Nova, ChromaDB and Firecrawl.
  The Whisper service queues internally and the Worker must tolerate a slow
  response or a 503 meaning "busy, try later", not a failure.

### Scheduling without Queues

Cloudflare Queues needs a paid plan, so it is not used. Instead:

- Fire the transcription with `ctx.waitUntil()` after the audio upload completes
- A cron trigger every 5 minutes sweeps anything stuck in
  `pending_transcription` for over 10 minutes and retries, up to 5 attempts
- Backoff between attempts, because a 503 means the VPS is busy, not broken

If KVM4 is down, logs sit in `pending_transcription` indefinitely and nothing is
lost. Audio is already safe in R2. The sweeper picks them up whenever the box
comes back.

### After transcription

Run the same matcher server side against the same taxonomy and pre select pills,
so the operator's review screen looks identical whichever path the log took.
Import the matcher from `src/shared`. Do not write a second copy.

---

## 12. R2 retention

Audio is small. A 30 second Opus clip at 24 kbps is roughly 90 KB. Sixty notes a
day is about 160 MB a month, against a 10 GB free allowance.

So do not delete aggressively:

- Standard storage for 180 days
- Lifecycle transition to Infrequent Access after that
- Expiry at 730 days

Key format: `audio/{shed_code}/{machine_no}/{log_id}/{seq}.webm`

Human readable keys matter when someone is digging through a bucket at 11pm.

---

## 13. What not to build

Explicitly out of scope for v1. Do not add these speculatively.

- Photo or video attachments
- Push notifications
- Spare parts inventory or stock levels
- Work order assignment or scheduling
- Any export beyond CSV
- Multi company or tenant support
- Anything requiring a paid plan

Reports and analytics come after operators are actually using it daily. Building
dashboards before there is data is the classic way to waste a month.
