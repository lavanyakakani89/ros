ALTER TABLE categories ADD COLUMN code TEXT;

WITH ranked AS (
  SELECT
    id,
    CASE
      WHEN parent_id IS NULL THEN 'C' || LPAD(ROW_NUMBER() OVER (PARTITION BY tenant_id, parent_id IS NULL ORDER BY created_at, name, id)::TEXT, 3, '0')
      ELSE 'SC' || LPAD(ROW_NUMBER() OVER (PARTITION BY tenant_id, parent_id IS NOT NULL ORDER BY created_at, name, id)::TEXT, 3, '0')
    END AS generated_code
  FROM categories
)
UPDATE categories
SET code = ranked.generated_code
FROM ranked
WHERE categories.id = ranked.id;

ALTER TABLE categories ALTER COLUMN code SET NOT NULL;

CREATE UNIQUE INDEX categories_tenant_id_code_key ON categories(tenant_id, code);
