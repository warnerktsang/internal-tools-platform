-- Substrate integrity, enforced by the database rather than by convention.
--
-- 1. The audit trail is append-only: UPDATE and DELETE are rejected outright.
-- 2. Every mutation of app-owned domain state must be accompanied by an audit row
--    written in the same transaction. This is the difference between "apps are
--    supposed to go through the transition layer" and "apps cannot not go through it".
--
-- The seeder sets `app.audit_bypass = 'on'` for its own transaction: loading fixture
-- data is not an operation performed by a principal, and pretending otherwise would
-- put fictional rows in the trail.

-- ---------------------------------------------------------------------------
-- 1. Append-only audit trail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION substrate_audit_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION substrate_audit_is_append_only();

-- ---------------------------------------------------------------------------
-- 2. No domain mutation without audit in the same transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION substrate_require_audit_row()
RETURNS TRIGGER AS $$
DECLARE
  target_resource text := TG_ARGV[0];
  target_id       text;
BEGIN
  IF coalesce(current_setting('app.audit_bypass', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_id := OLD.id;
  ELSE
    target_id := NEW.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM audit_events
    WHERE "txId" = txid_current()
      AND resource = target_resource
      AND "recordId" = target_id
  ) THEN
    RAISE EXCEPTION
      'domain mutation of %(%) has no audit row in this transaction: writes must go through the transition layer',
      target_resource, target_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER kyc_cases_require_audit
AFTER INSERT OR UPDATE OR DELETE ON kyc_cases
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION substrate_require_audit_row('kyc_case');

CREATE CONSTRAINT TRIGGER refunds_require_audit
AFTER INSERT OR UPDATE OR DELETE ON refunds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION substrate_require_audit_row('refund');

CREATE CONSTRAINT TRIGGER flag_configs_require_audit
AFTER INSERT OR UPDATE OR DELETE ON flag_configs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION substrate_require_audit_row('flag_config');
