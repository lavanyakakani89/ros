param(
  [string]$AgentDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "RetailOS Print Agent"
)

$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction Stop).Source
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$server = Join-Path $AgentDir "dist\server.js"

if (-not (Test-Path $server)) {
  throw "Build the print agent first: corepack pnpm --filter @retailos/print-agent build"
}

$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(
  "Set-Location -LiteralPath '$AgentDir'; & '$node' '$server'"
))
$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $encodedCommand" `
  -WorkingDirectory $AgentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -Hidden `
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
