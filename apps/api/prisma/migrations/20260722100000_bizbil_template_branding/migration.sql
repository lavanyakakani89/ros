UPDATE "invoice_templates"
SET "name" = REPLACE("name", 'RetailOS', 'BizBil')
WHERE "name" LIKE '%RetailOS%';
