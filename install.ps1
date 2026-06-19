# Thin shim: local clones run the checked-out installer; irm-pipe runs it via npm.

[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$InstallerArgs
)

$ErrorActionPreference = "Stop"
$Repo = "Athrean/Budzie"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Budzie: Node.js 18+ required: https://nodejs.org"
  exit 1
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
  Write-Error "Budzie: Node.js 18+ required; found $nodeMajor."
  exit 1
}

$scriptPath = $MyInvocation.MyCommand.Path
if ($scriptPath) {
  $local = Join-Path (Split-Path -Parent $scriptPath) "bin/budzie-install.mjs"
  if (Test-Path $local -PathType Leaf) {
    & node $local @InstallerArgs
    exit $LASTEXITCODE
  }
}

$npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npx) {
  Write-Error "Budzie: npx required; reinstall Node.js."
  exit 1
}

& npx -y "github:$Repo" @InstallerArgs
exit $LASTEXITCODE
