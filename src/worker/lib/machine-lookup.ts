export interface MachineWithShed {
  id: string;
  machineNo: string;
  shedId: string;
  shedCode: string;
  shedName: string;
}

export async function fetchMachineWithShed(
  db: D1Database,
  machineId: string,
): Promise<MachineWithShed | null> {
  const row = await db
    .prepare(
      `SELECT m.id, m.machine_no, m.shed_id, s.code AS shed_code, s.name AS shed_name
       FROM machines m JOIN sheds s ON s.id = m.shed_id
       WHERE m.id = ?`,
    )
    .bind(machineId)
    .first<Record<string, unknown>>();

  if (!row) return null;
  return {
    id: row.id as string,
    machineNo: row.machine_no as string,
    shedId: row.shed_id as string,
    shedCode: row.shed_code as string,
    shedName: row.shed_name as string,
  };
}
