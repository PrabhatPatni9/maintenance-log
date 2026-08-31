/**
 * Loads data/taxonomy.seed.json into taxonomy_items and taxonomy_synonyms.
 *
 * Shells out to `wrangler d1 execute` rather than talking to D1 directly —
 * that binary already knows how to reach both local Miniflare D1 and the
 * remote database, so this script stays a thin translator from JSON to SQL.
 *
 * Also seeds one demo shed with a couple of machines for local dev, per
 * AGENTS.md's "Local development" section, so `pnpm dev` has something to
 * click through without needing the admin screens first.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TaxonomySeed, TaxonomySeedEntry } from '../src/shared/taxonomy';

const isLocal = process.argv.includes('--local');

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function itemSql(entry: TaxonomySeedEntry, kind: 'action' | 'part'): string[] {
  const stmts: string[] = [];
  stmts.push(
    `INSERT OR IGNORE INTO taxonomy_items (code, kind, category, label_en, label_hi, label_mr, unit, sort_order, active)
     VALUES (${sqlString(entry.code)}, ${sqlString(kind)}, ${sqlString(entry.category)}, ${sqlString(entry.label_en)}, ${sqlString(entry.label_hi)}, ${sqlString(entry.label_mr)}, ${entry.unit ? sqlString(entry.unit) : 'NULL'}, 100, 1);`,
  );
  for (const phrase of entry.synonyms) {
    const script = /[ऀ-ॿ]/.test(phrase) ? 'deva' : 'latn';
    stmts.push(
      `INSERT OR IGNORE INTO taxonomy_synonyms (code, phrase, script) VALUES (${sqlString(entry.code)}, ${sqlString(phrase.toLowerCase())}, ${sqlString(script)});`,
    );
  }
  return stmts;
}

function main() {
  const seed: TaxonomySeed = JSON.parse(readFileSync('data/taxonomy.seed.json', 'utf8'));
  const stmts: string[] = [];

  for (const entry of seed.actions) stmts.push(...itemSql(entry, 'action'));
  for (const entry of seed.parts) stmts.push(...itemSql(entry, 'part'));

  if (isLocal) {
    const now = Date.now();
    stmts.push(
      `INSERT OR IGNORE INTO sheds (id, code, name, active, created_at) VALUES ('shed-demo-b', 'B', 'Shed B (demo)', 1, ${now});`,
      `INSERT OR IGNORE INTO machines (id, shed_id, machine_no, active, created_at) VALUES ('machine-demo-12', 'shed-demo-b', '12', 1, ${now});`,
      `INSERT OR IGNORE INTO machines (id, shed_id, machine_no, active, created_at) VALUES ('machine-demo-13', 'shed-demo-b', '13', 1, ${now});`,
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'ratanmoti-seed-'));
  const file = join(dir, 'seed.sql');
  writeFileSync(file, stmts.join('\n'));

  const args = ['d1', 'execute', 'ratanmoti-maintenance', isLocal ? '--local' : '--remote', '--file', file];
  console.log(`Applying ${stmts.length} statements (${isLocal ? 'local' : 'remote'})...`);
  execFileSync('wrangler', args, { stdio: 'inherit' });
}

main();
