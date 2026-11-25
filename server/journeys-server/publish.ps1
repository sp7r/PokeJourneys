param(
    [string]$OutputRoot = 'C:/Builds/PokeJourneys/server',
    [string[]]$Runtimes = @('win-x64', 'linux-arm64')
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'Journeys.Server.csproj'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\', '/')
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\', '/')
if ($OutputRoot -eq $repository -or $OutputRoot.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a publish folder outside the repository.'
}

foreach ($rid in $Runtimes) {
    $destination = Join-Path $OutputRoot $rid
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    & dotnet publish $project -c Release -r $rid -o $destination `
        -p:DebugType=embedded -p:PublishIISAssets=false -p:StaticWebAssetsEnabled=false
    if ($LASTEXITCODE -ne 0) { throw "Publishing $rid failed (exit $LASTEXITCODE)." }

    $extension = if ($rid -eq 'win-x64') { '.exe' } else { '' }
    Move-Item -LiteralPath (Join-Path $destination "Journeys.Server$extension") `
        -Destination (Join-Path $destination "PokeJourneysServer$extension") -Force
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'wwwroot/index.html'))) {
        throw "The admin page is missing from $destination."
    }
    Write-Host "Published $rid to $destination"
}
