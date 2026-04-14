-- Allow any string for dialog.disposition (forgiving of values outside spec).
-- Spec suggests: no-answer, congestion, failed, busy, hung-up, voicemail-no-message.
-- Drop the CHECK that restricted to only those values.
ALTER TABLE dialog DROP CONSTRAINT IF EXISTS dialog_disposition_check;
