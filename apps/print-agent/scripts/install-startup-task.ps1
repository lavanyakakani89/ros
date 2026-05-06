param(
  [string]$AgentDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "RetailOS Print Agent"
)

$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path $AgentDir "dist\server.js"

if (-not (Test-Path $server)) {
  throw "Build the print agent first: corepack pnpm --filter @retailos/print-agent build"
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$server`"" -WorkingDirectory $AgentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Runs RetailOS Local Print Agent on localhost for ESC/POS thermal printing." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "RetailOS Print Agent startup task installed and started."
Write-Host "Health check: http://127.0.0.1:9211/health"
