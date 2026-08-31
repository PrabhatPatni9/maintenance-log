import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { TaxonomyItemRecord } from '@shared/types';

export function Taxonomy() {
  const t = useT();
  const [items, setItems] = useState<TaxonomyItemRecord[]>([]);
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

      <form onSubmit={add} className="panel" style={{ padding: 16, marginBottom: 24, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
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
          className="btn"
          placeholder={t('admin.taxonomy.synonymsLabel')}
          value={form.synonyms}
          onChange={(e) => setForm({ ...form, synonyms: e.target.value })}
          style={{ textAlign: 'left', gridColumn: '1 / -1' }}
        />
        <p className="meta" style={{ gridColumn: '1 / -1' }}>
          {t('admin.taxonomy.synonymsHint')}
        </p>
        <button className="btn btn-primary" type="submit" style={{ gridColumn: '1 / -1' }}>
          {t('admin.taxonomy.addItem')}
        </button>
      </form>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item) => (
          <li key={item.code} className="panel" style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <strong>{item.code}</strong> · {item.labelEn} / {item.labelHi} / {item.labelMr} · {item.category}
              </span>
              <button className="btn" onClick={() => void toggleActive(item)}>
                {t(item.active ? 'common.deactivate' : 'common.activate')}
              </button>
            </div>
            <p className="meta" style={{ marginTop: 4 }}>
              {item.synonyms.join(', ')}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
