# BizBil — Agent Instructions

## App name
This app is called **BizBil**. The old name was RetailOS.
Never use "RetailOS" in any user-facing string, UI component,
page title, manifest, or logo area.

## Branding rules
- App name: BizBil
- Tagline: Bill fast. Biz smart.
- Brand teal: #0F6E56
- Brand amber: #B45309

## Logo assets (always use these, never text substitutes)
All logo files are in: `apps/web/public/bizbil-landing/icons/`

| File | Use |
|---|---|
| bizbil-mark.png | Small icon, sidebar square, favicon contexts |
| bizbil-wordmark.png | Login page, full logo with B mark |
| bizbil-wordmark-no-logo.png | Sidebar name area (B mark already shown beside it) |

## Allowed RetailOS references (do NOT change these)
- `apps/web/lib/offline-queue.ts` — IndexedDB name, changing breaks offline sync
- `apps/web/lib/local-print-agent.ts` — internal error messages only
- `apps/web/components/settings/printer-settings.tsx` — "RetailOS Local Agent" is a named component
- Package names in package.json — infrastructure only, not user-facing
- GitHub repo name `ros` — infrastructure, leave as-is

## Never do this
- Do not replace bizbil-mark.png or any logo Image tag with a CreditCard icon
- Do not change `name` or `short_name` in manifest.json away from "BizBil"
- Do not change `title` in layout.tsx away from "BizBil"
- Do not use plain text "BizBil" where a logo Image component should be used