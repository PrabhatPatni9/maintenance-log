# DESIGN.md

Visual and interaction spec for Ratanmoti Maintenance. Read after `CLAUDE.md`.

---

## Who this is for

A loom operator or fitter, aged 20 to 55, on a mid range Android phone, standing
in a bright shed with fluorescent tube lighting and 90 dB of rapier noise. Hands
are often oily. Phone may be held one handed. Reading is more comfortable in
Devanagari than Latin for most of them.

This is not an app that needs to look impressive. It needs to be legible at arm's
length under glare and operable with a thumb and a knuckle.

---

## Design direction

The vernacular here is machine panels, not SaaS. Looms carry painted metal
control boxes with amber indicator lamps, engraved plates and stencilled machine
numbers. The interface should feel like it belongs bolted to one of those, not
like a productivity app.

That means: high contrast, flat surfaces, no soft shadows, no gradients, no
rounded card grids. Structure comes from hairlines and blocks of solid colour.

**Light base, not dark.** Sheds are brightly lit and phone screens fight glare.
A dark theme looks better in a demo and is worse on the floor.

### Palette

```
--base     #F4F5F3   paper, the app background
--panel    #FFFFFF   raised surfaces, list rows
--ink      #16191A   primary text
--steel    #5A6570   secondary text, labels
--line     #D8DBD7   hairlines and dividers
--amber    #F2A81D   the record action, and only the record action
--signal   #1F7A4D   approved, synced, confirmed
--fault    #C43C2E   errors, faults, destructive
--queue    #2C6E9B   pending sync, informational
```

Amber is reserved. If amber appears on a screen, it means "this is the thing to
press". Using it decoratively destroys the one piece of signalling the app has.

### Type

**Anek** (Ek Type). Use `Anek Devanagari` for Devanagari and `Anek Latin` for
Latin, as one type system. It is a variable family with a width axis, designed in
India for exactly this pairing, and it renders Marathi correctly including the
eyelash ra which many Devanagari webfonts get wrong.

Self host the woff2 files. Do not rely on Google Fonts at runtime; the app must
render correctly offline on first paint.

```
Machine number   Anek, 700, width 75, tabular numerals, 40px
Screen title     Anek, 600, 24px
Body             Anek, 400, 17px, line-height 1.5
Pill label       Anek, 500, 16px
Meta / timestamp Anek, 400, 14px, --steel
```

17px body is deliberately larger than a normal app. Assume reading distance is
longer than usual and eyes are older than the designer's.

Do not use all caps labels. Devanagari has no case, so an all caps Latin label
next to a Devanagari one looks broken and inconsistent across languages.

### Touch targets

Minimum 56px. The record button is 96px. Pills are 48px tall with 12px gaps,
because a fat thumb deselecting the wrong pill is the most likely input error in
the whole app.

---

## The signature element: the capture ring

One bold thing, everything else quiet.

The record screen is dominated by a circular ring around a 96px amber button.
The ring fills over 45 seconds. Past the 45 second mark the ring is complete and
a thin outer arc, in a lighter amber, sweeps the remaining 5 seconds.

That outer arc is the grace tail made visible. The operator is not told "we are
secretly recording longer". They see a second, quieter band and learn within one
use that there is room past the countdown. It turns a hidden mechanism into a
reassurance.

```
        ┌─────────────────────────────┐
        │   Loom 12  ·  Shed B        │   machine, always visible
        │                             │
        │        ╭─────────╮          │
        │      ╭─┤  ◉ REC  ├─╮        │   inner ring: 45s fill
        │      │ ╰─────────╯ │        │   outer arc: 5s grace
        │      ╰─────────────╯        │
        │            0:23             │   counts down, tabular
        │                             │
        │   "बारा नंबर मशीनला oil     │   live interim transcript,
        │    change केला..."          │   grows upward, max 4 lines
        │                             │
        │  ┌───────────────────────┐  │
        │  │        Stop           │  │   full width, always reachable
        │  └───────────────────────┘  │
        └─────────────────────────────┘
```

The live transcript is the second most important thing on screen. Seeing their
own words appear is what makes an operator trust the app on day one. Show interim
results in `--steel` and final results in `--ink` so the settling is visible.

### After the timer

At 45 seconds the countdown reads `0:00` and a single line replaces it: "finish
your sentence". At 50 it stops on its own.

No sound. No vibration on start. One short vibration on stop, because the
operator may not be looking at the screen.

---

## Screen inventory

Eleven screens. If a twelfth appears, question it.

**Operator**
1. Language picker (first launch only, three large buttons, no other chrome)
2. Login (phone, password)
3. Home: big **Record a log** button, queue status, today's logs by this operator
4. Machine picker (QR scan primary, searchable list secondary, grouped by shed)
5. Capture (above)
6. Segment review: transcript, pills, **Add more**, **Done**
7. Log review: full transcript, all pills, **Approve**
8. Log detail (read only, after approval)

**Admin**
9. Sheds and machines CRUD, QR sticker sheet generator
10. Users CRUD
11. History: filter by shed, machine, operator, date, action code. CSV export.
    Admin edit with reason, writing to `log_edits`.

Taxonomy management lives inside 11 as a tab, not as a twelfth screen.

---

## Motion

Almost none. Three exceptions, all responses to a user action:

1. The capture ring, which is the point
2. A pill toggling selected state, 120ms
3. A queued log sliding out of the queue list when it syncs, 200ms

No page transitions, no fade ups, no skeleton shimmer. Show real content or show
nothing.

---

## Copy rules

Copy exists in three languages. Write English first, then have the Hindi and
Marathi checked by someone who speaks it daily, not by a translation API alone.

- Buttons name the outcome: **Approve**, not **Submit**
- Errors say what happened and what to do: "No internet. Your log is saved and
  will send automatically."
- Never apologise in an error
- Never use the word "sync" in operator facing copy. Use "sending" and "sent".
- Empty states point at the action: "No logs yet today. Record your first one."

Avoid words with no natural Marathi equivalent that operators actually use. If
the shed says "oil change" in English inside a Marathi sentence, the app should
too. Do not over translate technical terms into formal Marathi nobody says.

---

## Offline and glare checklist

Before any screen is called done:

- Readable at 50% brightness in a bright room
- Every interactive element reachable with a right thumb, one handed
- Works with airplane mode on
- Renders correctly with `lang="mr"` including conjuncts and the eyelash ra
- Visible keyboard focus for the admin screens, which get used on a desktop
- Respects `prefers-reduced-motion` by killing the ring animation to a plain
  numeric countdown
