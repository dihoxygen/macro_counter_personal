#!/usr/bin/env pwsh
# Moves the spec just created by /speckit-specify out of the master checkout into its own
# git worktree + branch, commits it there, and leaves master clean.
[CmdletBinding()]
param([switch]$Json)
$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Error $msg; exit 1 }

$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

$base = (git branch --show-current).Trim()
if ($base -notin @('master', 'main')) { Fail "Not on master/main (on '$base'); worktree not created." }

$featureFile = Join-Path $root '.specify/feature.json'
if (-not (Test-Path $featureFile)) { Fail 'No .specify/feature.json; run /speckit-specify first.' }
$specRel = ((Get-Content $featureFile -Raw | ConvertFrom-Json).feature_directory).Replace([string][char]92, '/')
$specRel = $specRel.TrimEnd('/')
$name = Split-Path $specRel -Leaf
if (-not (Test-Path (Join-Path $root $specRel))) { Fail "Spec directory '$specRel' not found." }
if (git ls-files -- $specRel) { Fail "'$specRel' is already tracked; it is not a new feature." }

# Refuse to run if anything other than the new spec dir (and gitignored files) is dirty.
$other = git status --porcelain | Where-Object { $_ -notmatch [regex]::Escape($specRel) }
if ($other) { Fail "Working tree has other changes; commit or stash first:`n$($other -join "`n")" }
if (git branch --list $name) { Fail "Branch '$name' already exists." }

$slug = $name -replace '^\d+-', ''
$wtPath = Join-Path (Split-Path $root -Parent) ((Split-Path $root -Leaf) + '-' + $slug)
if (Test-Path $wtPath) { Fail "Path '$wtPath' already exists." }

git worktree add -b $name $wtPath $base | Out-Null
if ($LASTEXITCODE) { Fail 'git worktree add failed.' }

$dest = Join-Path $wtPath $specRel
New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
Move-Item (Join-Path $root $specRel) $dest

git -C $wtPath add -- $specRel
git -C $wtPath commit -q -m "docs: add $name spec" -m 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'
if ($LASTEXITCODE) { Fail 'Commit in worktree failed.' }

# feature.json is gitignored and per-checkout: point the worktree at its spec, clear master's.
New-Item -ItemType Directory -Force (Join-Path $wtPath '.specify') | Out-Null
@{ feature_directory = $specRel } | ConvertTo-Json | Set-Content (Join-Path $wtPath '.specify/feature.json') -Encoding utf8
Remove-Item $featureFile -Force

$result = [ordered]@{ BRANCH_NAME = $name; WORKTREE_PATH = $wtPath; SPEC_DIR = $specRel; BASE = $base }
if ($Json) { $result | ConvertTo-Json -Compress } else { $result.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } }
