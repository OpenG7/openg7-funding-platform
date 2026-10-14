import type { Pool } from 'pg';

interface SchedulingFixture {
  slotId: string;
  originalDate: string;
  changedDate: string;
  members: { batchId: string; draftId: string }[];
}
export function createSchedulingFixture(pool: Pool): {
  fixture(options?: {
    shared?: boolean;
    unbound?: boolean;
  }): Promise<SchedulingFixture>;
  snapshot(fixture: SchedulingFixture): Promise<{
    slot: { starts_at: Date; status: string; notes: string | null };
    batches: {
      scheduled_at: Date | null;
      status: string;
      slot_id: string | null;
    }[];
    drafts: {
      scheduled_at: Date | null;
      status: string;
      batch_id: string | null;
    }[];
  }>;
};
