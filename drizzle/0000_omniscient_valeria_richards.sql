CREATE TYPE "public"."abandon_kind" AS ENUM('forfeit_abandon', 'timeout_abandon');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('ranked', 'casual');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('complete', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."participant_outcome" AS ENUM('win', 'loss', 'no_result');--> statement-breakpoint
CREATE TYPE "public"."player_status" AS ENUM('active', 'anonymized', 'banned');--> statement-breakpoint
CREATE TYPE "public"."player_type" AS ENUM('human', 'bot');--> statement-breakpoint
CREATE TYPE "public"."resolution_reason" AS ENUM('played_out', 'forfeit_abandon', 'timeout_abandon', 'aborted');--> statement-breakpoint
CREATE TABLE "bot_profiles" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"difficulty" text NOT NULL,
	"params" jsonb
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "player_type" NOT NULL,
	"clerk_user_id" text,
	"display_name" text NOT NULL,
	"avatar" text,
	"status" "player_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_clerk_identity_check" CHECK (("players"."type" = 'human') = ("players"."clerk_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"seat_index" smallint NOT NULL,
	"team" smallint,
	"outcome" "participant_outcome" NOT NULL,
	"placement" smallint,
	"final_score" integer NOT NULL,
	"is_abandoner" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" "match_mode" NOT NULL,
	"status" "match_status" NOT NULL,
	"resolution_reason" "resolution_reason" NOT NULL,
	"variant_id" text,
	"variant_version" integer,
	"variant_snapshot" jsonb NOT NULL,
	"variant_hash" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_hand_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_hand_id" uuid NOT NULL,
	"side" smallint NOT NULL,
	"meld" integer NOT NULL,
	"counters" integer NOT NULL,
	"total" integer NOT NULL,
	"cumulative" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_hands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"hand_number" integer NOT NULL,
	"bidder_seat" smallint NOT NULL,
	"contract_value" integer NOT NULL,
	"trump" text NOT NULL,
	"made" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_replays" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"schema_version" integer NOT NULL,
	"format" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abandon_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"kind" "abandon_kind" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_profiles" ADD CONSTRAINT "bot_profiles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_hand_lines" ADD CONSTRAINT "match_hand_lines_match_hand_id_match_hands_id_fk" FOREIGN KEY ("match_hand_id") REFERENCES "public"."match_hands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_hands" ADD CONSTRAINT "match_hands_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_replays" ADD CONSTRAINT "match_replays_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abandon_events" ADD CONSTRAINT "abandon_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abandon_events" ADD CONSTRAINT "abandon_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "players_clerk_user_id_key" ON "players" USING btree ("clerk_user_id") WHERE "players"."clerk_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "matches_completed_at_idx" ON "matches" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "abandon_events_player_id_idx" ON "abandon_events" USING btree ("player_id");