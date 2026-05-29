ALTER TABLE "sessions" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_share_token_unique" UNIQUE("share_token");