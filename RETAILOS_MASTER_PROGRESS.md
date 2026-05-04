# RetailOS Master Progress

Source: `C:\Users\Sivsan Oils\OneDrive\Old Files\Desktop\retailos-master-change-list.txt`

Legend: `[x]` completed and verified in code, `[~]` partially complete, `[ ]` pending.

## Current Deploy

- Latest deployed commit: `9d44048`
- Live URL: `https://ros.sivsanoils.in`
- Last verified: API health and web login page after deploy

## Section Progress

- [x] Section 0 - Critical bugs
  - Docker Chromium dependencies, workers, WhatsApp singleton, offline billing queue, Razorpay webhook, sidebar grouping verified/fixed.
- [~] Section 1 - Platform-wide changes
  - Done: GST tenant flag/toggle, GST-aware billing/product UI, ESLint root, prom-client metrics, role removed from localStorage, PWA PNG/iOS icons, MinIO file-domain proxy, report GST tab hidden for non-GST tenants.
  - Pending: full remaining currency sweep, GST-aware PDFs.
- [~] Section 2 - Keyboard shortcuts
  - Done: POS `Ctrl+1/2/3/4`, `Ctrl+H`, `Ctrl+N`, `Ctrl+P`, visible button badges and shortcut strip.
  - Pending: complete Escape behavior across every searchable dropdown.
- [~] Section 3 - Unified search box
  - Done: Billing and quotations use unified product/customer search.
  - Pending: shared reusable component and rollout to purchase orders and every remaining product selector.
- [~] Section 4 - Billing / POS
  - Done: customer quick-add, product search, no default line, discount model, cash received/change, preview modal, delivery gating, notes payload, held zero hiding.
  - Pending: delivery charge/scheduled time, stock block at confirm, MRP guard, invoice-history full detail workflow.
- [~] Section 5 - Quotations
  - Done: unified customer/product search, line table headers, live summary, bill discount, terms field, validity default, stock badges.
  - Pending: PDF/WhatsApp, conversion persistence, duplicate/revisions, auto-expiry job, detail view, list filters.
- [~] Section 6 - Coupons
  - Existing API/UI basic support present.
  - Pending: advanced coupon types, analytics, usage report, auto-apply, per-customer limits.
- [~] Section 7 - Loyalty
  - Existing API/UI basic support present.
  - Pending: full program/tier management and reports.
- [~] Section 8 - Customers
  - Existing CRUD/search/ledger basics present.
  - Pending: statement, outstanding list, broadcast, import, segmentation.
- [~] Section 9 - Inventory
  - Existing product CRUD/batches/stock basics present.
  - Pending: stock history detail, stock count, import, valuation movements.
- [~] Section 10 - Categories
  - Existing category screen/API present.
  - Pending: tree refinements and bulk reassignment.
- [~] Section 11 - Suppliers
  - Existing suppliers/payment basics present.
  - Pending: full ledger/outstanding/PO integration polish.
- [~] Section 12 - Purchase orders
  - Existing PO module present.
  - Pending: unified product search, receive/send polish, PDF/WhatsApp.
- [~] Section 13 - Purchase returns
  - Existing module present.
  - Pending: full send/PDF/workflow completion.
- [~] Section 14 - Credit notes
  - Existing module present.
  - Pending: full issue/cancel/PDF and invoice integration polish.
- [~] Section 15 - Delivery
  - Existing board and auto-create from POS present.
  - Pending: scheduled time from POS, delivery charge, notifications, failure reasons.
- [~] Section 16 - Payments
  - Existing payment record/list present plus Razorpay webhook.
  - Pending: advances, day-close, reconciliation, trends.
- [~] Section 17 - Expenses
  - Existing expense API/UI present.
  - Pending: receipt upload, recurring expenses, analytics/P&L integration.
- [~] Section 18 - Reports
  - Done: live summary/inventory/P&L/day-end reports, GST exports hidden when GST is disabled.
  - Pending: complete all report endpoints/charts/exports and acceptance tests.
- [~] Section 19 - Settings
  - Existing tenant/user/password/printer/template basics present; GST toggle added.
  - Pending: logo upload, notification settings, billing/delivery/loyalty defaults, richer template editor.
- [~] Section 20 - Audit log
  - Existing audit screen/API present.
  - Pending: audit entries wired across every significant mutation.
- [~] Section 21 - Super-admin portal
  - Existing login/dashboard/shop/template basics present.
  - Pending: full license/admin/audit/template/version workflows.
- [~] Section 22 - Invoice templates and thermal printer
  - Existing template/printer pipeline present.
  - Pending: full Monaco editor, versioning, all template sizes and browser Bluetooth/USB polish.
- [~] Section 23 - Dashboard
  - Done: live today sales, 7-day sales, inventory, P&L, open deliveries, offline queue count, recent audit activity, top products.
  - Pending: sparklines and remaining role/vertical-specific widgets.
- [~] Section 24 - Navigation/sidebar
  - Done: grouped navigation, colored icons, low-stock badge, delivery badge, outstanding-payment badge, real online/offline dot, GST status in sidebar header.
  - Pending: mobile collapse/expand polish and remaining module-specific badges.
- [~] Section 25 - Missing backend API routes summary
  - Many listed routes already exist.
  - Pending: remaining endpoints and route-level acceptance tests.

## Current Batch

- [x] Add PWA PNG/iOS icons.
- [x] Add MinIO file-domain proxy support.
- [x] Add invoice-history filters, pagination, status colors, and local print action.
- [x] Add POS MRP guard and stock-block-at-confirm.
- [x] Add dashboard live delivery/offline/audit signals.
- [x] Add navigation delivery/payment badge counts and real online/offline dot.
- [x] Hide GST report/export UI for non-GST tenants.
- [ ] Verify, push, deploy.
