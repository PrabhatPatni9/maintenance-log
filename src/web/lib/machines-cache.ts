import { api } from './api';
import { db } from './db';
import type { Machine, Shed } from '@shared/types';

/** Cached so the machine picker works offline (CLAUDE.md section 1: nothing
 * about picking a machine should need the network). Both endpoints already
 * come back scoped to what this operator was granted (or everything, for an
 * admin) — see GET /api/sheds and /api/machines. Refreshed opportunistically
 * whenever the picker opens with a connection. */
export async function refreshMachines(): Promise<void> {
  const [{ sheds }, { machines }] = await Promise.all([
    api.get<{ sheds: Shed[] }>('/sheds'),
    api.get<{ machines: Machine[] }>('/machines'),
  ]);
  const shedById = new Map(sheds.map((s) => [s.id, s]));

  await db.transaction('rw', db.machines, db.sheds, async () => {
    await db.sheds.clear();
    await db.sheds.bulkPut(sheds.map((s) => ({ id: s.id, code: s.code, name: s.name })));

    await db.machines.clear();
    await db.machines.bulkPut(
      machines
        .filter((m) => m.active)
        .map((m) => {
          const shed = shedById.get(m.shedId);
          return {
            id: m.id,
            shedId: m.shedId,
            shedCode: shed?.code ?? '',
            shedName: shed?.name ?? '',
            machineNo: m.machineNo,
            active: m.active,
          };
        }),
    );
  });
}
