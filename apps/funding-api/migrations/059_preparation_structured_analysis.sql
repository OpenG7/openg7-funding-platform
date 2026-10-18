-- Preserve local_rules_v1 results and inputs; new runs may use the structured local adapter.
-- No source is reanalysed and no commercial commitment or delivery is created.
ALTER TABLE preparation_assistance_runs
  DROP CONSTRAINT preparation_assistance_runs_adapter_check;
ALTER TABLE preparation_assistance_runs
  ADD CONSTRAINT preparation_assistance_runs_supported_adapter_check
  CHECK (adapter IN ('local_rules_v1', 'local_rules_v2'));

CREATE UNIQUE INDEX preparation_assistance_runs_active_inputs
  ON preparation_assistance_runs(source_id, commitment_version)
  WHERE state IN ('queued', 'processing');
