import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { TaxonomyItemRecord } from '@shared/types';

export function Taxonomy() {
  const t = useT();
  const [items, setItems] = useState<TaxonomyItemRecord[]>([]);
  // Collapsed by default: adding a taxonomy item is an occasional task
  // (CLAUDE.md — expanding the taxonomy is the shed supervisor's job, not a
  // daily one), and an 8-field form standing open ahead of the list it's
  // adding to means scrolling past all of it just to see what's there.
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    code: '',
    kind: 'action' as 'action' | 'part',
    category: '',
    labelEn: '',
    labelHi: '',
    labelMr: '',
    unit: '',
    synonyms: '',
  });

  function refresh() {
    void api.get<{ items: TaxonomyItemRecord[] }>('/taxonomy/all').then((r) => setItems(r.items));
  }
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/taxonomy', form);
    setForm({ code: '', kind: 'action', category: '', labelEn: '', labelHi: '', labelMr: '', unit: '', synonyms: '' });
    setShowAdd(false);
    refresh();
  }

  async function toggleActive(item: TaxonomyItemRecord) {
    await api.patch(`/taxonomy/${item.code}`, { active: !item.active });
    refresh();
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.taxonomy.title')}
      </h1>

      {!showAdd && (
        <button className="btn btn-block" style={{ marginBottom: 20 }} onClick={() => setShowAdd(true)}>
          + {t('admin.taxonomy.addItem')}
        </button>
      )}

      {showAdd && (
        <form
          onSubmit={add}
          className="panel"
          style={{ padding: 16, marginBottom: 24, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
        >
          <input className="input" placeholder={t('admin.taxonomy.codeLabel')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required style={{ textAlign: 'left' }} />
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'action' | 'part' })}>
            <option value="action">{t('admin.taxonomy.kindAction')}</option>
            <option value="part">{t('admin.taxonomy.kindPart')}</option>
          </select>
          <input className="input" placeholder={t('admin.taxonomy.categoryLabel')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required style={{ textAlign: 'left' }} />
          <input className="input" placeholder="English label" value={form.labelEn} onChange={(e) => setForm({ ...form, labelEn: e.target.value })} required style={{ textAlign: 'left' }} />
          <input className="input" placeholder="हिन्दी" value={form.labelHi} onChange={(e) => setForm({ ...form, labelHi: e.target.value })} required style={{ textAlign: 'left' }} />
          <input className="input" placeholder="मराठी" value={form.labelMr} onChange={(e) => setForm({ ...form, labelMr: e.target.value })} required style={{ textAlign: 'left' }} />
          <input className="input" placeholder={t('admin.taxonomy.unitLabel')} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} style={{ textAlign: 'left' }} />
          <input
            className="input"
            placeholder={t('admin.taxonomy.synonymsLabel')}
            value={form.synonyms}
            onChange={(e) => setForm({ ...form, synonyms: e.target.value })}
            style={{ gridColumn: '1 / -1' }}
          />
          <p className="meta" style={{ gridColumn: '1 / -1' }}>
            {t('admin.taxonomy.synonymsHint')}
          </p>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button className="btn" type="button" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" type="submit" style={{ flex: 1 }}>
              {t('admin.taxonomy.addItem')}
            </button>
          </div>
        </form>
      )}

      <ul className="stack-list">
        {items.map((item) => (
          <li key={item.code} className={`panel${item.active ? '' : ' is-off'}`} style={{ padding: 12 }}>
            <div style={{ fontWeight: 600 }}>
              {item.labelEn} <span className="meta">/ {item.labelHi} / {item.labelMr}</span>
            </div>
            <p className="meta" style={{ marginTop: 2 }}>
              {item.code} · {item.category}
              {item.synonyms.length > 0 && ` · ${item.synonyms.join(', ')}`}
            </p>
            <button className="btn btn-small" style={{ marginTop: 8 }} onClick={() => void toggleActive(item)}>
              {t(item.active ? 'common.deactivate' : 'common.activate')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
