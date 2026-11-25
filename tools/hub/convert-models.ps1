param(
    [Parameter(Mandatory=$true)][string]$Extract,
    [Parameter(Mandatory=$true)][string]$Pattern,
    [Parameter(Mandatory=$true)][string]$Out,
    [string]$Apicula = 'apicula'
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\') + '\'
$dest = [IO.Path]::GetFullPath($Out)
if ($dest.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'Game assets must be outside the repository.' }
if (!$dest.StartsWith('C:\Projects\hub-work\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be under C:\Projects\hub-work\' }
New-Item -ItemType Directory -Force $dest | Out-Null
$sets = @(Get-ChildItem -LiteralPath $Extract -Filter *.nsbtx | Sort-Object Name | ForEach-Object {
    @{ Path=$_.FullName; Text=[Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($_.FullName)) }
})
$manifest = @()
$models = @(Get-ChildItem -LiteralPath $Extract -Filter *.nsbmd | Where-Object {$_.BaseName -like $Pattern} | Sort-Object Name)
if (!$models.Count) { throw "No models match $Pattern" }
foreach ($model in $models) {
    $ErrorActionPreference = 'Continue'
    $info = (& $Apicula info $model.FullName 2>&1 | Out-String)
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE) { throw "Cannot inspect $($model.Name)" }
    $names = @([regex]::Matches($info, '(?m)^\s+(?:Texture|Palette): ([^\s]+)') | ForEach-Object {$_.Groups[1].Value.Trim('"')} | Sort-Object -Unique)
    $remaining = [Collections.Generic.HashSet[string]]::new([string[]]$names)
    $chosen = @()
    while ($remaining.Count) {
        $best = $null; $hits = @()
        foreach ($set in $sets) {
            $found = @($remaining | Where-Object {$set.Text.Contains($_ + [char]0) -or ($_.Length -eq 16 -and $set.Text.Contains($_))})
            if ($found.Count -gt $hits.Count) { $best=$set; $hits=$found }
        }
        if (!$best) { break }
        $chosen += $best.Path
        foreach ($name in $hits) { [void]$remaining.Remove($name) }
    }
    $modelOut = Join-Path $dest $model.BaseName
    New-Item -ItemType Directory -Force $modelOut | Out-Null
    $ErrorActionPreference = 'Continue'
    $log = & $Apicula convert $model.FullName @chosen -o $modelOut -f glb --overwrite 2>&1
    $ErrorActionPreference = 'Stop'
    $log | Set-Content (Join-Path $modelOut ($model.BaseName + '.convert.log'))
    if ($LASTEXITCODE) { throw "Conversion failed: $($model.Name)" }
    if (!(Get-ChildItem -LiteralPath $modelOut -Filter *.glb)) { throw "No GLB produced: $($model.Name)" }
    $manifest += [pscustomobject]@{Model=$model.Name;TextureSets=$chosen;Unresolved=@($remaining)}
    Write-Host "$($model.Name): $($chosen.Count) texture sets, $($remaining.Count) unresolved references"
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $dest ('manifest-' + ($Pattern -replace '[^a-zA-Z0-9_-]','_') + '.json'))
