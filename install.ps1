<#
.SYNOPSIS
  Install the dsh-web-search-bing-rss agent preset into ~/.dsh/.agent-presets/.
.DESCRIPTION
  Copies the preset files (preset.yml, agent.cordis.yml, entry.mjs, provider.js)
  into ~/.dsh/.agent-presets/bing-rss-search/, making the "Bing RSS 搜索" preset
  available in the DSH new-session preset selector.
.PARAMETER Force
  Overwrite an existing preset directory without prompting.
.EXAMPLE
  pwsh -File install.ps1
.EXAMPLE
  pwsh -File install.ps1 -Force
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$srcDir = $PSScriptRoot
$destDir = Join-Path (Join-Path (Join-Path $HOME '.dsh') '.agent-presets') 'bing-rss-search'

Write-Host "Source:  $srcDir"
Write-Host "Target:  $destDir"

if (Test-Path $destDir) {
  if (-not $Force) {
    $reply = Read-Host "Target exists. Overwrite? [y/N]"
    if ($reply -notmatch '^[yY]') { Write-Host "Aborted."; exit 1 }
  }
  Remove-Item $destDir -Recurse -Force
}

New-Item -ItemType Directory -Path $destDir -Force | Out-Null

# Source files: preset.yml and agent.cordis.yml are in the root; entry.mjs
# and provider.js are in lib/. The cordis loader resolves `./entry.mjs` and
# `./provider.js` relative to the preset directory, so both land side-by-side
# in the destination.
$files = @(
  @{ src = 'preset.yml';         dst = 'preset.yml' },
  @{ src = 'agent.cordis.yml';   dst = 'agent.cordis.yml' },
  @{ src = 'lib/entry.mjs';      dst = 'entry.mjs' },
  @{ src = 'lib/provider.js';    dst = 'provider.js' }
)

foreach ($f in $files) {
  $src = Join-Path $srcDir $f.src
  $dst = Join-Path $destDir $f.dst
  if (-not (Test-Path $src)) { Write-Error "Missing source file: $src"; exit 1 }
  Copy-Item $src $dst -Force
  Write-Host "  Copied $($f.dst)"
}

Write-Host ""
Write-Host "✅ Installed. Restart DSH (or start a new session) and select the"
Write-Host "   'Bing RSS 搜索' preset in the new-session preset selector."
Write-Host ""
Write-Host "   The preset registers a free Bing RSS search provider (id: bing-rss)"
Write-Host "   into ctx.web. When no DeepSeek API key is configured, it auto-selects."
Write-Host "   To force-select it even when DeepSeek is available, set env:"
Write-Host "     DSH_WEB_SEARCH_PROVIDER=bing-rss"
