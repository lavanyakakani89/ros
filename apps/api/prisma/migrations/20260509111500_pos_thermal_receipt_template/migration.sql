UPDATE "invoice_templates"
SET
  "name" = 'BizBil POS Thermal Receipt - 2 inch',
  "description" = 'Editable compact ESC/POS receipt for 2 inch POS thermal printers.',
  "escpos_config" = '{
    "columns": 32,
    "cut": true,
    "feedLinesBeforeCut": 6,
    "showShopName": true,
    "showAddress": true,
    "showPhone": true,
    "showGstin": true,
    "showCustomer": true,
    "showSubtotal": true,
    "showDiscount": true,
    "showDiscountOnlyWhenPresent": true,
    "showCgst": true,
    "showSgst": true,
    "showPaid": true,
    "showDue": true,
    "showDueOnlyWhenPresent": true,
    "showBatch": false,
    "footerMessage": "Thank you. Please visit again.",
    "labels": {
      "invoice": "Invoice",
      "date": "Date",
      "customer": "Customer",
      "itemHeader": "Item",
      "amountHeader": "Amount",
      "subtotal": "Subtotal",
      "discount": "Discount",
      "cgst": "CGST",
      "sgst": "SGST",
      "total": "TOTAL",
      "paid": "Paid",
      "due": "Due"
    }
  }'::jsonb,
  "ui_config" = '{"footer": {"message": "Thank you. Please visit again."}, "items": {"layout": "name-then-qty-rate-total"}, "header": {"showAddress": true, "showPhone": true, "showGstin": true}}'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'system-thermal-2';

UPDATE "invoice_templates"
SET
  "name" = 'BizBil POS Thermal Receipt - 3 inch',
  "description" = 'Editable ESC/POS receipt for 3 inch POS thermal printers such as ATPOS.',
  "escpos_config" = '{
    "columns": 42,
    "cut": true,
    "feedLinesBeforeCut": 6,
    "showShopName": true,
    "showAddress": true,
    "showPhone": true,
    "showGstin": true,
    "showCustomer": true,
    "showSubtotal": true,
    "showDiscount": true,
    "showDiscountOnlyWhenPresent": true,
    "showCgst": true,
    "showSgst": true,
    "showPaid": true,
    "showDue": true,
    "showDueOnlyWhenPresent": true,
    "showBatch": false,
    "footerMessage": "Thank you. Please visit again.",
    "labels": {
      "invoice": "Invoice",
      "date": "Date",
      "customer": "Customer",
      "itemHeader": "Item",
      "amountHeader": "Amount",
      "subtotal": "Subtotal",
      "discount": "Discount",
      "cgst": "CGST",
      "sgst": "SGST",
      "total": "TOTAL",
      "paid": "Paid",
      "due": "Due"
    }
  }'::jsonb,
  "ui_config" = '{"footer": {"message": "Thank you. Please visit again."}, "items": {"layout": "name-then-qty-rate-total"}, "header": {"showAddress": true, "showPhone": true, "showGstin": true}}'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'system-thermal-3';

UPDATE "invoice_templates"
SET
  "name" = 'BizBil POS Thermal Receipt - 4 inch',
  "description" = 'Editable wide ESC/POS receipt for 4 inch POS thermal printers.',
  "escpos_config" = '{
    "columns": 56,
    "cut": true,
    "feedLinesBeforeCut": 6,
    "showShopName": true,
    "showAddress": true,
    "showPhone": true,
    "showGstin": true,
    "showCustomer": true,
    "showSubtotal": true,
    "showDiscount": true,
    "showDiscountOnlyWhenPresent": true,
    "showCgst": true,
    "showSgst": true,
    "showPaid": true,
    "showDue": true,
    "showDueOnlyWhenPresent": true,
    "showBatch": false,
    "footerMessage": "Thank you. Please visit again.",
    "labels": {
      "invoice": "Invoice",
      "date": "Date",
      "customer": "Customer",
      "itemHeader": "Item",
      "amountHeader": "Amount",
      "subtotal": "Subtotal",
      "discount": "Discount",
      "cgst": "CGST",
      "sgst": "SGST",
      "total": "TOTAL",
      "paid": "Paid",
      "due": "Due"
    }
  }'::jsonb,
  "ui_config" = '{"footer": {"message": "Thank you. Please visit again."}, "items": {"layout": "name-then-qty-rate-total"}, "header": {"showAddress": true, "showPhone": true, "showGstin": true}}'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'system-thermal-4';
