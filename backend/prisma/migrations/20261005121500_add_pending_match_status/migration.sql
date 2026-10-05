-- Automatic provider discovery now creates matches as PENDING so an admin has to review them
-- before they enter the public lifecycle. Existing rows keep their current status.
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'PENDING';
