# docs/whisper-vps.md

Setting up the transcription service on KVM4. This is the only place audio is
processed by a model, and it runs on hardware Ratanmoti already pays for.

Target box: `72.60.223.104`, Ubuntu 24.04, 16 GB RAM, CPU only.

---

## The honest constraints

Read these before you start, because they shape every choice below.

**No GPU.** Everything is CPU inference. That rules out real time. This service
exists to drain a queue, not to answer a user waiting on a screen.

**The box is not empty.** Nova, Hermes, ChromaDB and Firecrawl already live
there. Whisper must be a polite neighbour: capped memory, concurrency of 1, and
niced below the other services.

**Marathi is the hard part.** Whisper's small and medium checkpoints are weak on
Marathi, often 40 to 60% word error. `large-v3` is the smallest checkpoint that
is genuinely usable for it. That is why the config below uses `large-v3` at int8
despite the speed cost, and why the fallback path is slow by design.

Expected throughput: a 50 second clip takes roughly 60 to 100 seconds. For a
queue that drains in the background, this is fine.

---

## Install

```bash
sudo mkdir -p /opt/whisper-svc && cd /opt/whisper-svc
python3 -m venv .venv
source .venv/bin/activate

pip install faster-whisper fastapi "uvicorn[standard]" python-multipart

# Pre-download the model so first request does not time out.
# large-v3 at int8 is roughly 1.5 GB on disk and about 2 GB resident.
python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', device='cpu', compute_type='int8')"
```

---

## The service

`/opt/whisper-svc/app.py`

```python
import os, asyncio, tempfile
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from faster_whisper import WhisperModel

TOKEN = os.environ["WHISPER_TOKEN"]

# int8 on CPU. Threads capped so Nova keeps breathing.
model = WhisperModel(
    "large-v3",
    device="cpu",
    compute_type="int8",
    cpu_threads=3,
    num_workers=1,
)

# Concurrency of exactly 1. A second request gets a 503 telling the Worker
# to retry later, which is correct: the cron sweeper will pick it back up.
lock = asyncio.Lock()
app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    lang: str = Form("hi"),
    authorization: str = Header(None),
):
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")

    if lock.locked():
        raise HTTPException(503, "busy")

    async with lock:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as tmp:
            tmp.write(await file.read())
            tmp.flush()

            segments, info = model.transcribe(
                tmp.name,
                language=lang,          # hi | mr | en, from the operator's setting
                task="transcribe",      # never translate. Store what they said.
                beam_size=1,            # greedy. Beam search is not worth the CPU here.
                vad_filter=True,        # loom noise between sentences is not speech
                vad_parameters={"min_silence_duration_ms": 500},
                condition_on_previous_text=False,  # stops loop-y hallucination on noise
            )

            text = " ".join(s.text.strip() for s in segments).strip()

    return {
        "text": text,
        "detectedLang": info.language,
        "confidence": round(float(info.language_probability), 3),
    }
```

Two settings matter more than they look:

- `vad_filter` strips the gaps. Without it, Whisper hallucinates fluent
  sentences out of loom noise, which is worse than returning nothing.
- `condition_on_previous_text=False` stops the repetition loop Whisper falls
  into on long noisy audio, where it repeats one phrase for thirty seconds.

---

## systemd

`/etc/systemd/system/whisper-svc.service`

```ini
[Unit]
Description=Whisper transcription for Ratanmoti Maintenance
After=network.target

[Service]
Type=simple
User=ratanmoti
WorkingDirectory=/opt/whisper-svc
Environment="WHISPER_TOKEN=CHANGE_ME"
ExecStart=/opt/whisper-svc/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 9200

# Keep it below Nova in priority and capped in memory.
Nice=10
MemoryMax=4G
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now whisper-svc
curl localhost:9200/health
```

Bound to `127.0.0.1` deliberately. The only way in is the tunnel.

---

## Exposing it

There is already a Cloudflare tunnel running on this box for ShedView. Add an
ingress rule rather than opening a port:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: stt.ratanmoti.in
    service: http://127.0.0.1:9200
  # existing ShedView rules below
  - service: http_status:404
```

```bash
sudo systemctl restart cloudflared
```

Then set the Worker secrets:

```bash
wrangler secret put WHISPER_URL      # https://stt.ratanmoti.in/transcribe
wrangler secret put WHISPER_TOKEN    # same value as in the systemd unit
```

---

## If Marathi accuracy is not good enough

Test with real shed audio before deciding. If `large-v3` disappoints on Marathi,
the upgrade path is AI4Bharat rather than a bigger Whisper:

- **IndicConformer** is per language, small, CPU friendly, and trained on Indian
  speech instead of treating it as a long tail. Marathi is covered.
- **IndicWhisper** is a Whisper variant fine tuned on Indian language corpora.

Both are Apache licensed and run locally. Swapping means rewriting the `model`
line and the `transcribe` call in `app.py`. Nothing in the Worker changes,
because the HTTP contract is the same.

---

## Watch list

If any of these go wrong, the queue backs up silently. Check them monthly.

- Disk: the model plus temp files want about 3 GB free
- RAM: `MemoryMax=4G` will kill the service rather than let it starve Nova.
  If it gets OOM killed regularly, drop to `distil-large-v3` and accept worse
  Marathi, or move Whisper to its own box.
- Queue depth: the admin screen from phase 6 shows logs stuck in
  `pending_transcription`. A number that only goes up means this service is down.
