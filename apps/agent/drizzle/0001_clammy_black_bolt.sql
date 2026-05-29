ALTER TABLE "events" ADD COLUMN "app" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "app" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "subject_id" uuid;