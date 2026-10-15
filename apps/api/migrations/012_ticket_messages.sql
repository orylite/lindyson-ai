ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS user_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_read_at timestamptz;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('user', 'admin')),
  author_user_id uuid REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_created ON ticket_messages(ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_author_created ON ticket_messages(author_user_id, created_at DESC);

INSERT INTO ticket_messages (ticket_id, author_role, author_user_id, body, created_at)
SELECT t.id, 'user', t.user_id, t.last_message, t.created_at
FROM tickets t
WHERE t.last_message <> ''
  AND NOT EXISTS (
    SELECT 1 FROM ticket_messages tm WHERE tm.ticket_id = t.id
  );

UPDATE tickets
SET user_read_at = COALESCE(user_read_at, created_at),
    admin_read_at = CASE
      WHEN status = 'resolved' THEN COALESCE(admin_read_at, updated_at)
      ELSE admin_read_at
    END;
