# PROMPTS.md

Copy one block at a time into your coding agent. Do not paste two phases at once.
Each phase ends with something you can actually open and use.

Every prompt assumes the agent has already read `CLAUDE.md`, `AGENTS.md` and
`DESIGN.md`. Start each session by saying so.

---

## Session opener (paste before every phase)

```
Read CLAUDE.md, AGENTS.md and DESIGN.md in full before writing any code.
Confirm in one sentence what you understood the project to be, then wait for
the phase prompt. Do not start building yet.
```

---

## Phase 0: Scaffold

```
Set up the repo skeleton described in CLAUDE.md section 4.

- pnpm workspace, TypeScript strict, Vite 6, React 19, TanStack Router
- Hono worker at src/worker/index.ts serving the API under /api/*
- Workers Static Assets serving the built Vite output for everything else,
  configured in wrangler.jsonc with an SPA fallback
- vite-plugin-pwa with a manifest: name "Ratanmoti Maintenance", short name
  "Maintenance", standalone display, portrait orientation, theme colour #F2A81D
- Dexie set up in src/web/lib/db.ts with empty schema for now
- The i18n layer in src/web/i18n with en.json, hi.json, mr.json and a useT()
  hook. Wire the Anek variable fonts, self hosted as woff2 in public/fonts.
- All the package.json scripts listed in AGENTS.md
- .github/workflows/deploy.yml exactly as in the repo already

Then apply migrations/0001_init.sql to local D1 and confirm it applies clean.

Deliverable: `pnpm dev` opens a page that says hello in whichever of the three
languages I pick on a first launch screen, and the choice persists on reload.
Nothing else.
```

---

## Phase 1: Auth, sheds, machines

```
Build authentication and the admin data layer.

Auth, following CLAUDE.md section 9 exactly:
- POST /api/auth/salt  { phone } -> { salt }  (returns a stable fake salt for
  unknown phones so the endpoint cannot be used to enumerate users)
- POST /api/auth/login { phone, derivedKey } -> sets httpOnly cookie, 90 days
- POST /api/auth/logout
- GET  /api/me
- Client side PBKDF2-SHA256, 150k iterations, in src/web/lib/crypto.ts.
  Put the comment explaining the 10ms CPU constraint directly above it.
- Session records in KV, so revocation works

Admin CRUD, admin role only:
- Sheds: create, rename, deactivate
- Machines: create, edit, deactivate. Fields per the schema, including
  shedview_id. Bulk create by pasting a range like "1-56" into one field,
  because nobody is adding 56 looms one at a time.
- Users: create operator or admin, set initial password, deactivate

Seed script that loads data/taxonomy.seed.json into taxonomy_items and
taxonomy_synonyms.

Deliverable: I can log in as an admin, create a shed, bulk create 56 machines,
create an operator account, log out, and log in as that operator.
```

---

## Phase 2: Capture, offline first, no transcription

```
Build the recording pipeline with no speech recognition at all yet. Audio only.

- Machine picker screen: searchable list grouped by shed, plus a QR scan button
  using the BarcodeDetector API with a jsQR fallback. QR payload is the machine
  id. Machine is always chosen before recording.
- Capture screen per DESIGN.md, including the capture ring with the 45 second
  inner fill and the 5 second outer grace arc
- MediaRecorder, Opus 24kbps mono. Starts the instant mic permission resolves.
  Hard stop at 50 seconds. Manual Stop button always available.
- One short vibration on stop. No sound.
- Every segment writes to Dexie immediately as a Blob, before anything else
- Outbox pattern in src/web/lib/queue.ts per CLAUDE.md section 7. Client
  generated UUIDv7 log ids. Idempotent server accept.
- Upload path: POST /api/logs creates the row, GET /api/logs/:id/segments/:seq/
  upload-url returns a presigned R2 PUT, client uploads directly, then
  POST .../complete marks it
- Queue count badge in the header at all times

Test it with the network disabled the entire time. Recording, queuing and
surviving a full page reload must all work offline.

Deliverable: with airplane mode on I can record three logs against three
machines, close the app, reopen it, turn the network on, and watch all three
upload with their audio landing in R2 under the key format in CLAUDE.md
section 12.
```

---

## Phase 3: Web Speech and the matcher

```
Add live transcription and pill detection.

src/web/lib/speech.ts:
- Wrap SpeechRecognition with continuous and interimResults true
- lang from the app language: hi-IN, mr-IN, en-IN
- Automatic restart inside onend, because Chrome silently ends around 60s
- Swallow the no-speech error with a comment saying it is deliberate
- Feature detect first. Also attempt SpeechRecognition.install() with
  processLocally for hi-IN and mr-IN, and use on device recognition if it
  succeeds. Do not depend on it succeeding.
- Runs in parallel with MediaRecorder, never instead of it. Audio is always
  captured regardless of whether recognition works.

Live interim transcript on the capture screen, interim in --steel, final in
--ink, per DESIGN.md.

src/web/lib/match.ts:
- Loads the taxonomy from Dexie, cached from GET /api/taxonomy
- Normalise: lowercase, collapse whitespace, strip punctuation. Nothing else.
- One case insensitive regex per taxonomy item, built from its synonym list,
  word boundaries. No transliteration, no fuzzy library.
- Returns matched item codes

Segment review screen: transcript editable as text, matched pills preselected,
tap to deselect, + Add opens a searchable full taxonomy list. Add more records
another segment onto the same log. Done goes to log review. Approve locks it.

If Web Speech is unavailable or returns nothing, fall through silently per
CLAUDE.md section 6. No error message. Offer the typed note box.

Deliverable: I speak "बारा नंबर मशीनला oil change केला आणि air compressor
मध्ये leakage होता" into a Marathi phone and see the transcript plus the
OIL_CHANGE and AIR_LEAKAGE pills preselected.
```

---

## Phase 4: Self hosted transcription

```
Handle the queued audio that Web Speech did not cover. Everything runs on
Ratanmoti's own KVM4 VPS. Do not call any hosted AI API.

- SttProvider interface in src/worker/stt/index.ts exactly as in CLAUDE.md
  section 11
- whisper.ts: POST the audio as multipart to WHISPER_URL with a bearer token.
  Expect it to be slow, 60 to 100 seconds for a 50 second clip. Treat a 503 as
  "busy, retry later", not a failure.
- stub.ts: returns a fixed string when WHISPER_URL is unset, for local dev
- Selected by the STT_PROVIDER env var
- Fire with ctx.waitUntil() after segment upload completes
- Cron trigger every 5 minutes sweeping logs stuck in pending_transcription for
  over 10 minutes, retrying up to 5 times with backoff before marking failed.
  If the VPS is down, logs must sit in the queue indefinitely without data loss.
- After transcription, run the same matcher server side against the same
  taxonomy and write the auto pills. Import it from src/shared, do not duplicate.

Also add STT_MODE handling on the client:
- hybrid (default): Web Speech live, Whisper for anything it missed
- local_only: never call SpeechRecognition at all, queue every segment for
  Whisper. This is the same code path as offline capture, so it should be a
  config branch, not a second implementation.

Deliverable: a log recorded in airplane mode with no Web Speech result arrives
transcribed with pills preselected once the phone reconnects and the VPS picks
it up. Setting STT_MODE to local_only makes every log take that path, and the
review screen looks identical either way.
```

## Phase 5: History, admin edit, PWA polish

```
- Log detail, read only after approval
- Admin history: filter by shed, machine, operator, date range, action code.
  Server side pagination, 50 per page.
- CSV export of the filtered set. One row per log_item, not per log, so the
  file drops straight into a pivot table.
- Admin edit: change the transcript or pills on an approved log. Requires a
  reason string. Appends to log_edits. Never overwrites. Shows an edited badge
  with the reason on the log detail screen.
- Taxonomy admin tab: add and edit items and synonyms. Synonym input accepts
  both scripts in one comma separated field. Changes take effect on the next
  taxonomy fetch, no deploy.
- QR sticker sheet generator: A4 PDF, machine number large and human readable
  above each QR, laid out for a sticker sheet
- PWA install prompt: capture beforeinstallprompt, show a dismissible bar after
  the operator's second successful log, not on first launch
- iOS gets an Add to Home Screen instruction sheet instead, since
  beforeinstallprompt does not fire there
- Offline shell: the app opens and reaches the capture screen with no network

Deliverable: an admin can find every repair done on loom 12 in the last quarter
and export it, and an operator's phone shows an install prompt at the right
moment.
```

---

## Phase 6: Field hardening

```
Only after two operators have used it for a week.

- Match quality report: for the last N logs, how many pills were auto vs manual,
  and which transcript phrases produced no match at all. This tells the
  supervisor exactly which synonyms to add.
- Retry and failure surface for admins: which logs are stuck and why
- Storage report: R2 usage against the 10GB free tier, D1 row counts
- Basic reports: repairs per machine per month, most common action codes, mean
  days between repairs per machine
- Session revocation UI

Do not start this phase before real usage data exists.
```

---

## Prompts for the human, not the agent

Two things no agent can do for you.

### Before phase 3

Take a phone into the shed during a running shift. Open a Web Speech API test
page. Have three different operators describe real repairs in Hindi, Marathi and
mixed. Write down what the loom noise does to accuracy.

If accuracy holds, the whole architecture is validated. If it collapses, the
fallback path in phase 4 becomes the primary path and you should tell the agent
so before it builds phase 3.

### Before phase 1

Sit with the shed supervisor and expand `data/taxonomy.seed.json`. Target the
80% of repairs that cover 95% of events. For every item, capture the words
operators actually say, including the Hinglish forms, in both Devanagari and
Latin script.

This is an hour of work that determines whether the structured data is worth
anything. Do it before the schema is seeded, not after.
