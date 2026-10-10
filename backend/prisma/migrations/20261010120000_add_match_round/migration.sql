-- League round / matchday stated by the provider (football-data.org's `matchday`, for example 8) or
-- entered by an admin. Nullable and additive, so every existing row keeps its data and a match whose
-- round is unknown stays null rather than being guessed from a competition name or a cup stage label.
ALTER TABLE "Match" ADD COLUMN "round" INTEGER;
