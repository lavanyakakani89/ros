param(
  [string]$TaskName = "RetailOS Print Agent"
)

$ErrorActionPreference = "Stop"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "RetailOS Print Agent startup task removed."
