# RetailOS Local Print Agent

RetailOS Local Print Agent is a small Windows-side Node app for ATPOS and other ESC/POS thermal printers. The cloud app returns raw ESC/POS invoice bytes. The browser sends those bytes to `http://127.0.0.1:9211`, and the local agent sends them to the selected Windows printer with the paper cut command included.

The agent is designed to run hidden in the background. Shop owners should not need to keep a command window open.

## What gets installed

- Node runs `apps/print-agent/dist/server.js`.
- A Windows Scheduled Task named `RetailOS Print Agent` starts it at user login.
- The scheduled task launches `apps/print-agent/scripts/start-hidden.vbs` through `wscript.exe`, so no console window is shown.
- The local HTTP server listens on `127.0.0.1:9211` only.

## Install on the billing PC

Run PowerShell as Administrator, then run these commands from the RetailOS repo on the Windows billing computer:

```powershell
cd D:\suri-projects\retail-os
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @retailos/print-agent build
powershell -ExecutionPolicy Bypass -File apps/print-agent/scripts/install-startup-task.ps1
```

If the scheduled task already exists and you are reinstalling after a code update, use:

```powershell
cd D:\suri-projects\retail-os
git pull
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @retailos/print-agent build
Stop-ScheduledTask -TaskName "RetailOS Print Agent" -ErrorAction SilentlyContinue
powershell -ExecutionPolicy Bypass -File apps/print-agent/scripts/install-startup-task.ps1
```

## Verify it is running

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:9211/health
```

Expected result:

```text
status : ok
app    : RetailOS Local Print Agent
```

Printer list:

```powershell
Invoke-RestMethod http://127.0.0.1:9211/printers
```

Scheduled task status:

```powershell
Get-ScheduledTask -TaskName "RetailOS Print Agent" | Select-Object TaskName, State
```

Expected `State` is `Running`.

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

## Troubleshooting

### `No connection could be made because the target machine actively refused it`

The agent is not running. Start it:

```powershell
Start-ScheduledTask -TaskName "RetailOS Print Agent"
Invoke-RestMethod http://127.0.0.1:9211/health
```

If it still refuses the connection, reinstall the task from Administrator PowerShell:

```powershell
cd D:\suri-projects\retail-os
corepack pnpm --filter @retailos/print-agent build
powershell -ExecutionPolicy Bypass -File apps/print-agent/scripts/install-startup-task.ps1
```

### A black command window appears

The old startup task or a manually started Node process is still running. Close the visible window once, then reinstall the latest task from Administrator PowerShell:

```powershell
cd D:\suri-projects\retail-os
git pull
Stop-ScheduledTask -TaskName "RetailOS Print Agent" -ErrorAction SilentlyContinue
corepack pnpm --filter @retailos/print-agent build
powershell -ExecutionPolicy Bypass -File apps/print-agent/scripts/install-startup-task.ps1
```

After restart, no window should appear. Verify with:

```powershell
Invoke-RestMethod http://127.0.0.1:9211/health
```

### Scheduled task says `Ready`, not `Running`

Start it manually:

```powershell
Start-ScheduledTask -TaskName "RetailOS Print Agent"
```

Then verify health. If it returns to `Ready` immediately, check the last run result:

```powershell
Get-ScheduledTaskInfo -TaskName "RetailOS Print Agent" | Select-Object LastRunTime, LastTaskResult
```

Common causes are missing Node.js, not running the build command, or installing the task from a moved/deleted repo path.

### Uninstall

Run from the repo:

```powershell
powershell -ExecutionPolicy Bypass -File apps/print-agent/scripts/uninstall-startup-task.ps1
```
