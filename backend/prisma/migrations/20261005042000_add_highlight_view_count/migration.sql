-- Adds the durable view counter used by POST /api/v1/highlights/:id/view.
ALTER TABLE "Highlight" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
