-- Admin rejections become an explicit, durable review state instead of a plain soft delete, so the
-- fixture can never return as a new PENDING row on a later sync. Existing rows are untouched: the
-- previous soft-deleted PENDING rows keep working through the same rejection lookup.
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
