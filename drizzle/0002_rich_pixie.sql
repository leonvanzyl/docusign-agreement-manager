ALTER TABLE "conversation" ADD COLUMN "agent_session_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "tool_calls" jsonb;