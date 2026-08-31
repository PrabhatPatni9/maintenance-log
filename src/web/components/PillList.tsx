import { useMemo, useState } from 'react';
import { useLang, useT } from '../i18n';
import type { CachedTaxonomyItem } from '../lib/db';
import { labelFor } from '@shared/taxonomy';
import type { TaxonomyItemRecord } from '@shared/types';

export interface SelectedItem {
  code: string;
  origin: 'auto' | 'manual';
}

interface Props {
  all: CachedTaxonomyItem[];
  selected: SelectedItem[];
  onToggle(code: string): void;
  onAdd(code: string): void;
}

/**
 * Fat-thumb-proof pills (DESIGN.md: 48px tall, 12px gaps — deselecting the
 * wrong one is the most likely input error in the app) plus the + Add
 * searchable list for anything the matcher missed.
 */
export function PillList({ all, selected, onToggle, onAdd }: Props) {
  const t = useT();
  const { lang } = useLang();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const selectedCodes = new Set(selected.map((s) => s.code));
  const byCode = useMemo(() => new Map(all.map((i) => [i.code, i])), [all]);

  const searchResults = useMemo(() => {
    if (!adding) return [];
    const q = query.trim().toLowerCase();
    return all
      .filter((i) => !selectedCodes.has(i.code))
      .filter((i) => !q || labelFor(i as unknown as TaxonomyItemRecord, lang).toLowerCase().includes(q))
      .slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, query, all, selected]);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        {selected.map((s) => {
          const item = byCode.get(s.code);
          if (!item) return null;
          return (
            <button
              key={s.code}
              onClick={() => onToggle(s.code)}
              className="btn"
              style={{
                minHeight: 48,
                borderRadius: 999,
                background: 'var(--ink)',
                color: 'var(--panel)',
                borderColor: 'var(--ink)',
                fontWeight: 500,
              }}
            >
              {labelFor(item as unknown as TaxonomyItemRecord, lang)} ✕
            </button>
          );
        })}
        <button
          className="btn"
          style={{ minHeight: 48, borderRadius: 999 }}
          onClick={() => setAdding((v) => !v)}
        >
          {t('segment.addPill')}
        </button>
      </div>

      {selected.length === 0 && !adding && <p className="meta">{t('segment.noPillsDetected')}</p>}

      {adding && (
        <div className="panel" style={{ padding: 12 }}>
          <input
            className="btn btn-block"
            style={{ textAlign: 'left', marginBottom: 8 }}
            placeholder={t('segment.searchTaxonomy')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
            {searchResults.map((item) => (
              <button
                key={item.code}
                className="btn"
                style={{ minHeight: 48, borderRadius: 999 }}
                onClick={() => {
                  onAdd(item.code);
                  setQuery('');
                }}
              >
                {labelFor(item as unknown as TaxonomyItemRecord, lang)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
