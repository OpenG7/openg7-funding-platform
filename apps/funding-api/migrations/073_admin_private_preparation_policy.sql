-- Opt-in, one-dossier private preparation only. Existing runs stay manual.
ALTER TABLE admin_automatic_runs ADD COLUMN preparation_policy JSONB;
ALTER TABLE admin_automatic_runs ADD CONSTRAINT admin_run_private_policy_shape CHECK (
  preparation_policy IS NULL OR COALESCE(
    jsonb_typeof(preparation_policy)='object'
    AND preparation_policy->>'capability'='private_preparation'
    AND preparation_policy->'confirmed'='true'::jsonb
    AND preparation_policy->'maxDossiers'='1'::jsonb
    AND preparation_policy->'maxProviderCalls'='0'::jsonb
    AND preparation_policy->'maxCostMinor'='0'::jsonb
    AND preparation_policy->>'costCurrency'='CAD'
    AND preparation_policy->'maxDrafts' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb)
    AND jsonb_typeof(preparation_policy->'expiresAt')='string', FALSE)
);

CREATE FUNCTION protect_admin_private_preparation_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.preparation_policy IS DISTINCT FROM OLD.preparation_policy THEN
    RAISE EXCEPTION 'private preparation policy is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_automatic_runs_immutable_preparation_policy
  BEFORE UPDATE ON admin_automatic_runs
  FOR EACH ROW EXECUTE FUNCTION protect_admin_private_preparation_policy();
