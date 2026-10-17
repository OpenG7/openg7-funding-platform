-- Dossier preparation is independent from actor-owned batches. Historical 056
-- records and their immutable snapshots remain intact, including their run FK.
ALTER TABLE admin_preparation_approvals ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE admin_preparation_approvals ADD COLUMN approval_generation INTEGER NOT NULL DEFAULT 1
  CHECK (approval_generation IN (1,2));
-- The old application's INSERT also receives generation 2 during an upgrade;
-- only rows already present when the column was added retain generation 1.
ALTER TABLE admin_preparation_approvals ALTER COLUMN approval_generation SET DEFAULT 2;
-- Older history can contain equivalent approvals from different runs. Do not
-- rewrite it to add uniqueness: enforce one new logical approval per dossier
-- and version across both contexts from this generation onward.
CREATE UNIQUE INDEX admin_preparation_approvals_current_identity
  ON admin_preparation_approvals(contribution_id,preparation_version)
  WHERE approval_generation=2;
