CREATE TYPE "public"."agreement_source" AS ENUM('manual', 'esignature', 'agreement_manager');--> statement-breakpoint
ALTER TYPE "public"."agreement_status" ADD VALUE 'voided';--> statement-breakpoint
ALTER TYPE "public"."agreement_type" ADD VALUE 'other';--> statement-breakpoint
ALTER TABLE "agreement" ADD COLUMN "source" "agreement_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "agreement" ADD COLUMN "envelope_id" text;--> statement-breakpoint
ALTER TABLE "agreement" ADD COLUMN "agreement_id" text;--> statement-breakpoint
ALTER TABLE "agreement" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "agreement" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_user_external_key_uq" ON "agreement" USING btree ("user_id","external_key");