UPDATE "invoice_templates"
SET
  "escpos_config" = COALESCE("escpos_config", '{}'::jsonb) || '{
    "spacing": {
      "headerBlankLines": 1,
      "itemSerialWidth": 4,
      "itemNameWidth": 16,
      "itemQtyWidth": 7,
      "itemPriceWidth": 7,
      "itemAmountWidth": 8,
      "lineGapBetweenItems": 0,
      "summaryItemWidth": 12,
      "summaryQtyWidth": 12,
      "summaryAmountLabelWidth": 9,
      "summaryAmountWidth": 9,
      "beforeFooterBlankLines": 1
    }
  }'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'system-sivsan-detailed-thermal-3';
