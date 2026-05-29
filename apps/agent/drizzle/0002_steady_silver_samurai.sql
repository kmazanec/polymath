CREATE TABLE "experiment_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition_order" text NOT NULL,
	"qualitative_notes" text,
	"polymath_session_id" uuid,
	"baseline_session_id" uuid,
	"followup_token" text NOT NULL,
	"followup_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_subjects_followup_token_unique" UNIQUE("followup_token")
);
--> statement-breakpoint
CREATE TABLE "followup_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"target_rep_override" text NOT NULL,
	"submission" text NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"condition" text NOT NULL,
	"item_id" text NOT NULL,
	"submission" text NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pre_test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"submission" text NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject_item_usage" (
	"subject_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"phase" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_item_usage_subject_id_item_id_pk" PRIMARY KEY("subject_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "experiment_subjects" ADD CONSTRAINT "experiment_subjects_polymath_session_id_sessions_id_fk" FOREIGN KEY ("polymath_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_subjects" ADD CONSTRAINT "experiment_subjects_baseline_session_id_sessions_id_fk" FOREIGN KEY ("baseline_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_results" ADD CONSTRAINT "followup_results_subject_id_experiment_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."experiment_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_test_results" ADD CONSTRAINT "post_test_results_subject_id_experiment_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."experiment_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_test_results" ADD CONSTRAINT "pre_test_results_subject_id_experiment_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."experiment_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_item_usage" ADD CONSTRAINT "subject_item_usage_subject_id_experiment_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."experiment_subjects"("id") ON DELETE no action ON UPDATE no action;