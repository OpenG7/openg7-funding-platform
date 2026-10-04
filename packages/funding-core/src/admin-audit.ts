export interface AdminAuditLogEntry {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string | null;
  readonly summary: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

export interface AdminAuditLogResponse {
  readonly data_source: 'database';
  readonly entries: readonly AdminAuditLogEntry[];
  readonly last_updated_at: string;
}
