import { Hono } from 'hono';
import type { AppEnv } from './lib/middleware';
import type { Env } from './lib/env';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { shedRoutes } from './routes/sheds';
import { machineRoutes } from './routes/machines';
import { userRoutes } from './routes/users';
import { taxonomyRoutes } from './routes/taxonomy';
import { logRoutes } from './routes/logs';
import { historyRoutes } from './routes/history';
import { dashboardRoutes } from './routes/dashboard';
import { transcribeLog } from './lib/transcribe';
import { selectProvider } from './stt/select';

const app = new Hono<AppEnv>();

app.get('/api/config', (c) => c.json({ sttMode: c.env.STT_MODE }));

app.route('/api/auth', authRoutes);
app.route('/api/me', meRoutes);

app.route('/api/sheds', shedRoutes);
app.route('/api/machines', machineRoutes);
app.route('/api/admin/users', userRoutes);
app.route('/api/taxonomy', taxonomyRoutes);
app.route('/api/logs', logRoutes);
app.route('/api/admin/history', historyRoutes);
app.route('/api/admin/dashboard', dashboardRoutes);

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
  // Everything else is the SPA. Workers Static Assets applies the
  // single-page-application fallback configured in wrangler.jsonc.
  return c.env.ASSETS.fetch(c.req.raw);
});

const RETRY_STUCK_AFTER_MS = 10 * 60 * 1000;
const MAX_RETRIES = 5;

/**
 * No Cloudflare Queues on the free plan, so this cron (every 5 minutes, see
 * wrangler.jsonc triggers) is the retry mechanism for anything ctx.waitUntil
 * didn't finish right after upload — most commonly because Whisper on KVM4
 * was busy or the box was down (CLAUDE.md section 11).
 */
async function sweepPendingTranscriptions(env: Env): Promise<void> {
  const cutoff = Date.now() - RETRY_STUCK_AFTER_MS;
  const { results } = await env.DB.prepare(
    `SELECT id FROM logs
     WHERE status = 'pending_transcription' AND server_received_at < ? AND retry_count < ?
     LIMIT 20`,
  )
    .bind(cutoff, MAX_RETRIES)
    .all<{ id: string }>();

  const provider = selectProvider(env);

  for (const row of results) {
    const done = await transcribeLog(env, provider, row.id).catch(() => false);
    if (!done) {
      await env.DB.prepare('UPDATE logs SET retry_count = retry_count + 1 WHERE id = ?')
        .bind(row.id)
        .run();
    }
  }

  await env.DB.prepare(
    `UPDATE logs SET status = 'failed', fail_reason = 'stt retries exhausted'
     WHERE status = 'pending_transcription' AND retry_count >= ?`,
  )
    .bind(MAX_RETRIES)
    .run();
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweepPendingTranscriptions(env));
  },
};
