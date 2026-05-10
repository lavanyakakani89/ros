ALTER TABLE users ADD COLUMN username TEXT;

WITH numbered_users AS (
  SELECT
    id,
    lower(email) AS base_username,
    row_number() OVER (PARTITION BY tenant_id, lower(email) ORDER BY created_at, id) AS duplicate_number
  FROM users
  WHERE username IS NULL
)
UPDATE users
SET username = CASE
  WHEN numbered_users.duplicate_number = 1 THEN numbered_users.base_username
  ELSE numbered_users.base_username || '-' || numbered_users.duplicate_number::text
END
FROM numbered_users
WHERE users.id = numbered_users.id;

CREATE UNIQUE INDEX users_tenant_id_username_key ON users(tenant_id, username);
