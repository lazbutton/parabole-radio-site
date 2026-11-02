CREATE TYPE "public"."chat_color" AS ENUM('red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white');--> statement-breakpoint
CREATE TYPE "public"."chat_decider" AS ENUM('rules', 'team', 'reports');--> statement-breakpoint
CREATE TYPE "public"."chat_links" AS ENUM('none', 'music', 'all');--> statement-breakpoint
CREATE TYPE "public"."chat_status" AS ENUM('visible', 'held', 'refused', 'removed');--> statement-breakpoint
CREATE TYPE "public"."chat_term_action" AS ENUM('refuse', 'hold', 'mask');--> statement-breakpoint
CREATE TABLE "chat_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" "chat_decider" NOT NULL,
	"member_id" uuid,
	"action" text NOT NULL,
	"message_id" uuid,
	"author_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_action" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_author" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"pseudo" text NOT NULL,
	"pseudo_key" text NOT NULL,
	"color" "chat_color" NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"muted_until" timestamp with time zone,
	"banned_at" timestamp with time zone,
	"banned_reason" text,
	"banned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_author_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "chat_author_pseudo_key_unique" UNIQUE("pseudo_key"),
	CONSTRAINT "chat_author_pseudo" CHECK (char_length("chat_author"."pseudo") between 3 and 20)
);
--> statement-breakpoint
ALTER TABLE "chat_author" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid,
	"member_id" uuid,
	"pseudo" text NOT NULL,
	"color" "chat_color" NOT NULL,
	"body" text NOT NULL,
	"status" "chat_status" NOT NULL,
	"on_air_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"decided_by" "chat_decider" DEFAULT 'rules' NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_body" CHECK (char_length("chat_message"."body") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "chat_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_report_once" UNIQUE("message_id","reporter_id")
);
--> statement-breakpoint
ALTER TABLE "chat_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"slow_seconds" integer DEFAULT 0 NOT NULL,
	"delay_seconds" integer DEFAULT 0 NOT NULL,
	"careful" boolean DEFAULT false NOT NULL,
	"ticker" boolean DEFAULT true NOT NULL,
	"links" "chat_links" DEFAULT 'music' NOT NULL,
	"report_threshold" integer DEFAULT 3 NOT NULL,
	"cleared_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_settings_single" CHECK ("chat_settings"."id"),
	CONSTRAINT "chat_settings_slow" CHECK ("chat_settings"."slow_seconds" in (0, 3, 5, 10, 30, 60)),
	CONSTRAINT "chat_settings_delay" CHECK ("chat_settings"."delay_seconds" in (0, 5, 10, 30)),
	CONSTRAINT "chat_settings_threshold" CHECK ("chat_settings"."report_threshold" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "chat_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"action" "chat_term_action" DEFAULT 'refuse' NOT NULL,
	"anywhere" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_term_term_unique" UNIQUE("term"),
	CONSTRAINT "chat_term_length" CHECK (char_length("chat_term"."term") between 2 and 60)
);
--> statement-breakpoint
ALTER TABLE "chat_term" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_author_id_chat_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."chat_author"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_member_id_member_user_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_report" ADD CONSTRAINT "chat_report_message_id_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_report" ADD CONSTRAINT "chat_report_reporter_id_chat_author_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."chat_author"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_action_created" ON "chat_action" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_action_author" ON "chat_action" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_message_status_on_air" ON "chat_message" USING btree ("status","on_air_at");--> statement-breakpoint
CREATE INDEX "chat_message_author_created" ON "chat_message" USING btree ("author_id","created_at");