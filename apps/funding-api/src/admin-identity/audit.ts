import type { PoolClient } from 'pg';

export const auditAdminIdentity = async (
  db: PoolClient,
  actor: string,
  action: string,
  target: string,
  metadata: Record<string, unknown> = {}
): Promise<void> => {
  await db.query(
    `INSERT INTO admin_audit_log (actor,action,entity_type,entity_id,metadata)
    VALUES ($1,$2,'admin_access',$3,$4::jsonb)`,
    [actor, action, target, JSON.stringify(metadata)]
  );
};
