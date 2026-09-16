DROP INDEX IF EXISTS "Notification_userId_idx";
DROP INDEX IF EXISTS "Notification_isRead_idx";
DROP INDEX IF EXISTS "Notification_userId_isRead_idx";
DROP INDEX IF EXISTS "Notification_createdAt_idx";

CREATE INDEX "Notification_userId_channel_deletedAt_createdAt_id_idx"
  ON "Notification" ("userId", "channel", "deletedAt", "createdAt", "id");

CREATE INDEX "Notification_userId_channel_isRead_deletedAt_idx"
  ON "Notification" ("userId", "channel", "isRead", "deletedAt");
