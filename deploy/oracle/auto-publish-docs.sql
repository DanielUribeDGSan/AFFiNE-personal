-- Auto-publish every user doc in the Shift workspace:
-- public read for guests (external), comments for logged-in members.
-- System docs (workspace root, db$*) are skipped.

CREATE OR REPLACE FUNCTION shift_auto_publish_doc(
  p_workspace_id text,
  p_doc_id text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_doc_id IS NULL THEN
    RETURN;
  END IF;
  -- skip workspace root + internal meta docs
  IF p_doc_id = p_workspace_id OR p_doc_id LIKE 'db$%' THEN
    RETURN;
  END IF;

  INSERT INTO workspace_pages (
    workspace_id, page_id, mode, blocked, published_at
  ) VALUES (
    p_workspace_id, p_doc_id, 0, false, NOW()
  )
  ON CONFLICT (workspace_id, page_id) DO UPDATE SET
    published_at = COALESCE(workspace_pages.published_at, EXCLUDED.published_at);

  INSERT INTO doc_access_policies (
    workspace_id, doc_id, visibility, public_role, member_default_role,
    url_preview_enabled, published_at, created_at, updated_at
  ) VALUES (
    p_workspace_id, p_doc_id, 'public', 'external', 'commenter',
    true, NOW(), NOW(), NOW()
  )
  ON CONFLICT (workspace_id, doc_id) DO UPDATE SET
    visibility = 'public',
    public_role = 'external',
    member_default_role = 'commenter',
    url_preview_enabled = true,
    published_at = COALESCE(doc_access_policies.published_at, EXCLUDED.published_at, NOW()),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION shift_auto_publish_on_workspace_page()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workspace_id = 'ea8aff53-982d-4f60-88ee-e42e829b3bee' THEN
    PERFORM shift_auto_publish_doc(NEW.workspace_id, NEW.page_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION shift_auto_publish_on_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workspace_id = 'ea8aff53-982d-4f60-88ee-e42e829b3bee' THEN
    PERFORM shift_auto_publish_doc(NEW.workspace_id, NEW.guid);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shift_auto_publish_workspace_pages ON workspace_pages;
CREATE TRIGGER trg_shift_auto_publish_workspace_pages
AFTER INSERT ON workspace_pages
FOR EACH ROW
EXECUTE FUNCTION shift_auto_publish_on_workspace_page();

DROP TRIGGER IF EXISTS trg_shift_auto_publish_snapshots ON snapshots;
CREATE TRIGGER trg_shift_auto_publish_snapshots
AFTER INSERT ON snapshots
FOR EACH ROW
EXECUTE FUNCTION shift_auto_publish_on_snapshot();

-- Backfill any missing public policies for existing user docs
SELECT shift_auto_publish_doc(s.workspace_id, s.guid)
FROM snapshots s
WHERE s.workspace_id = 'ea8aff53-982d-4f60-88ee-e42e829b3bee'
  AND s.guid <> s.workspace_id
  AND s.guid NOT LIKE 'db$%';
