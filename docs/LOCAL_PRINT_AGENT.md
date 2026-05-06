# RetailOS Local Print Agent

RetailOS Local Print Agent is a small Windows-side Node app for ATPOS and other ESC/POS thermal printers. The cloud app returns raw ESC/POS invoice bytes. The browser sends those bytes to `http://127.0.0.1:9211`, and the local agent sends them to the selected Windows printer with the paper cut command included.

## Install on the billing PC

Run these commands from the RetailOS repo on the Windows billing computer:

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @retailos/print-agent build
powershell -ExecutionPolicy Bypass -File apps/print-agent/scripts/install-startup-task.ps1
```

Verify:

```powershell
Invoke-RestMethod http://127.0.0.1:9211/health
Invoke-RestMethod http://127.0.0.1:9211/printers
```

## Configure RetailOS

1. Open `Settings > Printer setup`.
2. Set `Connection type` to `RetailOS Local Agent`.
3. Set `Paper size` to `THERMAL_3` for a 3 inch ATPOS printer.
4. Click `Check agent`.
5. Click `Load Windows printers`.
6. Put the exact ATPOS Windows printer name in `Local Windows printer name`.
7. Save printer settings.
8. Click `Test print`.

## ATPOS notes

Use the vendor ATPOS driver if it accepts RAW/ESC/POS jobs. If cut or alignment is wrong, install the Windows `Generic / Text Only` driver for the printer and select that printer name in RetailOS. RetailOS already appends ESC/POS reset and full-cut commands, so no browser plugin or third-party cloud print service is needed for normal USB printing.

The agent listens only on `127.0.0.1` by default. Keep it that way on shop PCs.
