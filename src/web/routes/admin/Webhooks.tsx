import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { RequireSuperAdmin } from '../../lib/guards';
import { api, ApiError } from '../../lib/api';
import type { Machine, Shed, Webhook, WebhookScope } from '@shared/types';

function scopeLabel(t: (k: string, vars?: Record<string, string>) => string, w: Webhook, sheds: Shed[], machines: Machine[]): string {
  if (w.scopeType === 'global') return t('admin.webhooks.scopeGlobal');
  if (w.scopeType === 'shed') {
    const shed = sheds.find((s) => s.id === w.scopeId);
    return t('admin.webhooks.scopeShed', { name: shed ? `${shed.code} — ${shed.name}` : w.scopeId ?? '' });
  }
  const machine = machines.find((m) => m.id === w.scopeId);
  return t('admin.webhooks.scopeMachine', { name: machine ? machine.machineNo : w.scopeId ?? '' });
}

function statusLabel(t: (k: string, vars?: Record<string, string>) => string, w: Webhook): string {
  if (!w.lastFiredAt) return t('admin.webhooks.neverFired');
  const when = new Date(w.lastFiredAt).toLocaleString();
  if (w.lastError) return t('admin.webhooks.lastError', { when, error: w.lastError });
  return t('admin.webhooks.lastOk', { when, status: String(w.lastStatus ?? '') });
}

/**
 * Owner tier only, by design (webhooks.ts) — a webhook URL can leak shed
 * data to anywhere on the internet, so this stays off the shed-scoped
 * admin's panel entirely, not just hidden.
 */
function WebhooksInner() {
  const t = useT();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);

  const [scopeType, setScopeType] = useState<WebhookScope>('global');
  const [scopeId, setScopeId] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<{ id: string; secret: string } | null>(null);

  const [testResult, setTestResult] = useState<Record<string, string>>({});

  function refresh() {
    void api.get<{ webhooks: Webhook[] }>('/admin/webhooks').then((r) => setWebhooks(r.webhooks));
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => {
      setSheds(r.sheds);
      if (!scopeId && r.sheds[0]) setScopeId(r.sheds[0].id);
    });
    void api.get<{ machines: Machine[] }>('/machines').then((r) => setMachines(r.machines));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAddError('');
    try {
      const { webhook, secret } = await api.post<{ webhook: Webhook; secret: string }>('/admin/webhooks', {
        scopeType,
        scopeId: scopeType === 'global' ? undefined : scopeId,
        url,
      });
      setUrl('');
      setRevealedSecret({ id: webhook.id, secret });
      refresh();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : t('admin.webhooks.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(w: Webhook) {
    await api.patch(`/admin/webhooks/${w.id}`, { active: !w.active });
    refresh();
  }

  async function remove(w: Webhook) {
    if (!window.confirm(t('admin.webhooks.deleteConfirm', { url: w.url }))) return;
    await api.del(`/admin/webhooks/${w.id}`);
    refresh();
  }

  async function test(w: Webhook) {
    setTestResult((prev) => ({ ...prev, [w.id]: t('common.loading') }));
    try {
      const r = await api.post<{ lastStatus: number | null; lastError: string | null }>(`/admin/webhooks/${w.id}/test`, {});
      setTestResult((prev) => ({
        ...prev,
        [w.id]: r.lastError ? t('admin.webhooks.testFailed', { error: r.lastError }) : t('admin.webhooks.testOk', { status: String(r.lastStatus) }),
      }));
    } catch {
      setTestResult((prev) => ({ ...prev, [w.id]: t('admin.webhooks.saveError') }));
    }
    refresh();
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 6 }}>
        {t('admin.webhooks.title')}
      </h1>
      <p className="meta" style={{ marginBottom: 20 }}>
        {t('admin.webhooks.hint')}
      </p>

      <form onSubmit={add} className="panel stacked-form">
        <div>
          <label className="field-label">{t('admin.webhooks.scopeLabel')}</label>
          <select className="input" value={scopeType} onChange={(e) => setScopeType(e.target.value as WebhookScope)}>
            <option value="global">{t('admin.webhooks.scopeGlobal')}</option>
            <option value="shed">{t('admin.webhooks.scopeShedOption')}</option>
            <option value="machine">{t('admin.webhooks.scopeMachineOption')}</option>
          </select>
        </div>

        {scopeType === 'shed' && (
          <div>
            <label className="field-label">{t('admin.sheds.title')}</label>
            <select className="input" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              {sheds.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {scopeType === 'machine' && (
          <div>
            <label className="field-label">{t('admin.machines.title')}</label>
            <select className="input" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.machineNo} · {sheds.find((s) => s.id === m.shedId)?.code ?? ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="field-label">{t('admin.webhooks.urlLabel')}</label>
          <input
            className="input"
            type="url"
            placeholder="https://script.google.com/macros/s/.../exec"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>

        {addError && <p style={{ color: 'var(--fault)', margin: 0 }}>{addError}</p>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {t('admin.webhooks.addWebhook')}
        </button>
      </form>

      {revealedSecret && (
        <div className="panel" style={{ padding: 16, marginBottom: 20, borderColor: 'var(--amber)' }}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>{t('admin.webhooks.secretTitle')}</p>
          <p className="meta" style={{ marginBottom: 10 }}>
            {t('admin.webhooks.secretHint')}
          </p>
          <code
            style={{
              display: 'block',
              padding: 10,
              background: 'var(--base)',
              border: '1px solid var(--line)',
              wordBreak: 'break-all',
              fontSize: 13,
              marginBottom: 10,
            }}
          >
            {revealedSecret.secret}
          </code>
          <button className="btn btn-block" onClick={() => setRevealedSecret(null)}>
            {t('admin.webhooks.secretDismiss')}
          </button>
        </div>
      )}

      <ul className="stack-list">
        {webhooks.map((w) => (
          <li key={w.id} className={`panel${w.active ? '' : ' is-off'}`} style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{w.url}</div>
            <div className="meta" style={{ marginTop: 2 }}>
              {scopeLabel(t, w, sheds, machines)}
              {!w.active && ` · ${t('common.inactive')}`}
            </div>
            <div className="meta" style={{ marginTop: 4 }}>
              {testResult[w.id] ?? statusLabel(t, w)}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn btn-small" onClick={() => void test(w)}>
                {t('admin.webhooks.test')}
              </button>
              <button className="btn btn-small" onClick={() => void toggleActive(w)}>
                {t(w.active ? 'common.deactivate' : 'common.activate')}
              </button>
              <button className="btn btn-small btn-danger" onClick={() => void remove(w)}>
                {t('common.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {webhooks.length === 0 && <p className="meta" style={{ marginTop: 12 }}>{t('admin.webhooks.empty')}</p>}
    </div>
  );
}

export function Webhooks() {
  return (
    <RequireSuperAdmin>
      <WebhooksInner />
    </RequireSuperAdmin>
  );
}
