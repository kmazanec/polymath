CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_state" (
	"session_id" uuid NOT NULL,
	"kc" text NOT NULL,
	"bkt_probability" real,
	"mastery_state" text,
	"signals" jsonb,
	CONSTRAINT "learner_state_session_id_kc_pk" PRIMARY KEY("session_id","kc")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"lesson_progress" jsonb
);
--> statement-breakpoint
CREATE TABLE "transfer_bank" (
	"item_id" text PRIMARY KEY NOT NULL,
	"lesson_id" integer NOT NULL,
	"target_expression" text NOT NULL,
	"truth_table" jsonb NOT NULL,
	"target_rep" text NOT NULL,
	"hidden_reps" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validated_distractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_expression" text NOT NULL,
	"distractor_expression" text NOT NULL,
	"truth_table" jsonb NOT NULL,
	"is_near_miss" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_state" ADD CONSTRAINT "learner_state_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;