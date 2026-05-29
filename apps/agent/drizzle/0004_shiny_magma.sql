ALTER TABLE "sessions" ADD COLUMN "delete_after" timestamp with time zone;
--> statement-breakpoint
-- MR !8 review: backfill already-ended Polymath sessions so the privacy sweep covers
-- data that ended BEFORE this deploy. Without this, a session with ended_at set but
-- delete_after NULL is never scheduled (delete_after <= now() never matches NULL) — a
-- silent fail-open of the default-delete posture (ADR-012 AC#9). Grace = ended_at + 24h,
-- the same default the runtime scheduler uses; app IS NULL scopes to Polymath rows only.
UPDATE "sessions"
SET "delete_after" = "ended_at" + interval '24 hours'
WHERE "ended_at" IS NOT NULL AND "delete_after" IS NULL AND "app" IS NULL;