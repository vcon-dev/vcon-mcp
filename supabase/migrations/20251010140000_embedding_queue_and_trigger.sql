-- Optional queue + trigger for embedding workflow

CREATE TABLE IF NOT EXISTS embedding_queue (
  id bigserial PRIMARY KEY,
  vcon_id uuid NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enqueue_embedding() RETURNS trigger AS $$
BEGIN
  INSERT INTO embedding_queue(vcon_id) VALUES (NEW.id);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enqueue_embedding ON vcons;
CREATE TRIGGER trg_enqueue_embedding
AFTER INSERT ON vcons
FOR EACH ROW EXECUTE FUNCTION enqueue_embedding();


