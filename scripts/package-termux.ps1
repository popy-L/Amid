$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$stage = Join-Path $env:TEMP "amid-termux-package"
$archive = Join-Path $dist "Amid-Termux.zip"

if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}

New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "server.js") -Destination $stage
if (Test-Path -LiteralPath (Join-Path $root "package-lock.json")) {
  Copy-Item -LiteralPath (Join-Path $root "package-lock.json") -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "AUTONOMY_ARCHITECTURE.md") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "public") -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $root "lib") -Destination $stage -Recurse
New-Item -ItemType Directory -Path (Join-Path $stage "scripts") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "scripts\termux") -Destination (Join-Path $stage "scripts") -Recurse

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $archive -CompressionLevel Optimal
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Output "Created $archive"
