import type { Pool, PoolClient } from 'pg';

export async function audit(
  db: Pool | PoolClient,
  actor: string,
  action: string,
  target: string,
  metadata: object = {}
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata) VALUES($1,$2,'pilotage',$3,$4::jsonb)`,
    [actor, 'pilotage.' + action, target, JSON.stringify(metadata)]
  );
}
