param(
  [string]$TaskName = "BizBil Print Agent"
)

$ErrorActionPreference = "Stop"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "BizBil Print Agent startup task removed."
