-- Older drizzle-kit versions do not quote generated constraint names containing dashes.
-- Rename the existing key without changing its columns or any message data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'ai-app-template_message'
      AND c.conname = 'ai-app-template_message_chat_id_id_pk'
  ) THEN
    ALTER TABLE "ai-app-template_message"
      RENAME CONSTRAINT "ai-app-template_message_chat_id_id_pk" TO "message_chat_id_id_pk";
  END IF;
END $$;
