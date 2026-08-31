# AGENTS.md

Operating rules for any agent working in this repo. Applies to Claude Code,
Manus, Codex, Cursor, or anything else.

Read `CLAUDE.md` first. This file is about how to work, not what to build.

---

## Ground rules

1. **Build in the phases defined in `PROMPTS.md`.** Do not jump ahead. Phase N+1
   assumes phase N is merged and working.
2. **Never invent scope.** If a feature seems obviously needed but is not in
   `CLAUDE.md`, stop and ask. Section 13 of `CLAUDE.md` lists what is explicitly
   out.
3. **Throw, do not swallow.** Errors surface loudly with context. No bare
   `catch {}`, no `console.log` in place of handling. The one exception is the
   `no-speech` error from `SpeechRecognition`, which is expected and swallowed
   deliberately with a comment saying so.
4. **Safe write, never overwrite.** Any operation that could clobber existing
   data reads first, merges, and writes. This applies to D1 rows, R2 objects and
   IndexedDB records alike.
5. **No string literals in the web app.** Every user visible string goes through
   the i18n layer in all three languages, at the time the component is written.
   A screen with English hardcoded is not done.
6. **Nothing paid, and no hosted AI.** If you find yourself reaching for
   Cloudflare Queues, paid Durable Object features, or any hosted model API
   (OpenAI, Gemini, Anthropic, Sarvam, Deepgram, AssemblyAI, Workers AI), stop
   and flag it. Transcription is the browser engine or KVM4. Structuring is
   regex. There is no third option.
7. **Do not touch `data/taxonomy.seed.json` content.** Its structure is yours to
   read; its contents belong to the shed supervisor. Build the admin UI that lets
   a human edit it instead.

---

## Commands

```bash
pnpm install

pnpm dev              # vite dev server + wrangler dev, concurrently
pnpm dev:web          # frontend only
pnpm dev:worker       # worker only, local D1

pnpm typecheck        # tsc --noEmit across web, worker, shared
pnpm lint
pnpm test

pnpm db:migrate:local # wrangler d1 migrations apply --local
pnpm db:migrate:prod  # wrangler d1 migrations apply --remote
pnpm db:seed:local    # loads taxonomy.seed.json + a demo shed

pnpm build            # vite build into dist/
pnpm deploy           # wrangler deploy. CI does this, not you.
```

`pnpm typecheck` must pass before any commit. There is no negotiation on this.

---

## Local development

D1 and R2 both run locally through `wrangler dev` with `--local`. You do not need
Cloudflare credentials to develop.

Two things do not work locally and must be handled:

- **Web Speech API needs `https` or `localhost`.** `localhost` is fine. If you
  test on a phone over LAN IP, the mic will be blocked. Use a Cloudflare tunnel
  or `vite --host` with a self signed cert.
- **Whisper transcription needs the VPS.** Without `WHISPER_URL` set, the STT
  provider falls back to a stub that returns a fixed string. That is correct
  behaviour for local dev, not a bug to fix. Do not stand up a hosted model to
  work around it.

### Testing the capture flow without a shed

`pnpm dev` exposes `/dev/simulate` in development only. It lets you feed a fixed
transcript string through the matcher and see which pills light up. Use it to
test taxonomy changes without talking to your laptop.

---

## Repository conventions

- TypeScript everywhere, `strict: true`, no `any` without a comment explaining it
- Named exports only, no default exports except route components
- Route files under 200 lines. If one grows past that, the logic belongs in `lib`
- SQL lives in migration files, not inline in route handlers, except for simple
  parameterised queries
- All IDs are UUIDv7, generated client side where the client owns the record
- Timestamps are integer epoch milliseconds, UTC, everywhere. Formatting happens
  at render time in `Asia/Kolkata`

### Commits

Conventional commits. Small. One concern per commit.

```
feat(capture): add 5s grace tail to recording window
fix(sync): retry only failed segments, not whole log
chore(i18n): add mr strings for review screen
```

---

## Deployment

CI deploys. Agents do not run `pnpm deploy` against production.

### GitHub Actions

`.github/workflows/deploy.yml` runs on push to `main`:

1. typecheck, lint, test
2. `wrangler d1 migrations apply --remote`
3. `wrangler deploy`

Required repo secrets:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard, custom token, see below |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard sidebar |

The API token needs these permissions, scoped to the account holding
`ratanmoti.in`:

- Account : Workers Scripts : Edit
- Account : Workers KV Storage : Edit
- Account : Workers R2 Storage : Edit
- Account : D1 : Edit
- Zone : Workers Routes : Edit (on `ratanmoti.in`)

Do not use a Global API Key. Create a scoped token.

### Worker secrets

These are set with `wrangler secret put`, not in `wrangler.jsonc`, and not in
GitHub secrets:

```bash
wrangler secret put JWT_SECRET
wrangler secret put WHISPER_URL     # https endpoint on the KVM4 tunnel
wrangler secret put WHISPER_TOKEN   # bearer token for that endpoint
```

There is no third party AI key to set, because there is no third party AI.

### For Manus

Manus handles the Cloudflare side. What Manus needs to do, in order:

1. Create the D1 database, R2 bucket and KV namespace named in `CLAUDE.md`
   section 3, in the `prabhatpatni9` account
2. Paste the returned IDs into `wrangler.jsonc` where the `REPLACE_ME`
   placeholders are
3. Set the three Worker secrets above
4. Create the scoped API token and add the two GitHub repo secrets
5. Push to `main` and confirm the Action goes green
6. Bind `maintenance.ratanmoti.in` as a custom domain on the Worker
7. Apply the R2 lifecycle rule from `CLAUDE.md` section 12
8. Confirm the Whisper service on KVM4 answers through the tunnel, per
   `docs/whisper-vps.md`. If it is not up yet, the app still works; logs just
   queue in `pending_transcription` until it is.

Manus should not modify application code. If a build fails for a code reason,
report it back rather than patching.

---

## Definition of done

A phase is done when all of these are true:

- `pnpm typecheck` and `pnpm test` pass
- Every new user visible string exists in `en`, `hi` and `mr`
- The feature works with the network disabled
- The feature works on a 360px wide viewport
- No new dependency was added without saying why in the PR description
- `CLAUDE.md` was updated if a decision in it changed
