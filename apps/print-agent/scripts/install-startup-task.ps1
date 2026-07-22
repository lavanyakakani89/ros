param(
  [string]$AgentDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "BizBil Print Agent"
)

$ErrorActionPreference = "Stop"

$wscript = (Get-Command wscript.exe -ErrorAction Stop).Source
$server = Join-Path $AgentDir "dist\server.js"
$launcher = Join-Path $AgentDir "scripts\start-hidden.vbs"

if (-not (Test-Path $server)) {
  throw "Build the print agent first: corepack pnpm --filter @retailos/print-agent build"
}

$action = New-ScheduledTaskAction `
  -Execute $wscript `
  -Argument "//B //Nologo `"$launcher`"" `
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
  -Description "Runs BizBil Local Print Agent on localhost for ESC/POS thermal printing." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "BizBil Print Agent startup task installed and started."
Write-Host "Health check: http://127.0.0.1:9211/health"
