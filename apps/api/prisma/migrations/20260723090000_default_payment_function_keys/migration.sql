-- Default payment methods use function keys; custom methods keep Ctrl+number shortcuts.
-- Clear function-key use before assigning defaults so per-store unique constraints
-- cannot conflict with an older manual shortcut.
UPDATE "payment_methods"
SET "keyboard_shortcut" = NULL
WHERE "keyboard_shortcut" IN ('F2', 'F4', 'F8', 'F9');

UPDATE "payment_methods"
SET "keyboard_shortcut" = CASE "type"
  WHEN 'CASH' THEN 'F2'
  WHEN 'UPI' THEN 'F4'
  WHEN 'CARD' THEN 'F8'
  WHEN 'CREDIT' THEN 'F9'
  ELSE "keyboard_shortcut"
END
WHERE "is_default" = true
  AND "type" IN ('CASH', 'UPI', 'CARD', 'CREDIT');
