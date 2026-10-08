-- Season label exactly as the provider states it (for example "2026/2027" from football-data.org's
-- season span, or API-Football's season year). Nullable, so every existing row keeps its data and
-- matches without provider season information stay null rather than being invented.
ALTER TABLE "Match" ADD COLUMN "season" VARCHAR(32);
