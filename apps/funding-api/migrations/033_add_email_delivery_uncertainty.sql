-- Preserve historical messages. New attempts cannot automatically replay an
-- uncertain external result, including a worker lost after SMTP acceptance.
ALTER TABLE email_messages DROP CONSTRAINT email_messages_status_check;
ALTER TABLE email_messages ADD CONSTRAINT email_messages_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'uncertain'));
ALTER TABLE email_messages ADD COLUMN delivery_attempt_id UUID;
