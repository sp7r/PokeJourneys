# Builds the server for Oracle's ARM machines and installs it on the VM in one go: copies the build over SSH and
# runs rebuild.sh there, which copies the database, restarts the service and checks it answers.
#   powershell -File server/journeys-server/deploy/deploy.ps1 -Target ubuntu@VM_IP -Domain journeys.example.com
# The target and domain are remembered on this PC, so later updates are just:
#   powershell -File server/journeys-server/deploy/deploy.ps1
param(
    [string]$Target,
    [string]$Domain,
    [string]$Key
)

$ErrorActionPreference = 'Stop'
$settingsPath = Join-Path $env:LOCALAPPDATA 'PokeJourneysDeploy/oracle.json'
$settings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json } else { $null }
if (-not $Target -and $settings) { $Target = $settings.target }
if (-not $Domain -and $settings) { $Domain = $settings.domain }
if (-not $Key -and $settings) { $Key = $settings.key }
if (-not $Target -or -not $Domain) { throw 'Give -Target user@VM_IP and -Domain journeys.example.com the first time.' }
New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath) | Out-Null
@{ target = $Target; domain = $Domain; key = $Key } | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding utf8

$ssh = @('-o', 'ServerAliveInterval=15')
if ($Key) { $ssh += @('-i', $Key) }
function Invoke-Native([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe failed (exit $LASTEXITCODE)." }
}

$builds = 'C:/Builds/PokeJourneys/server'
& (Join-Path $PSScriptRoot '../publish.ps1') -OutputRoot $builds -Runtimes linux-arm64
# The hub map for the bot players: places from the repository, walkable tiles from the last app build.
$hub = New-Item -ItemType Directory -Force -Path "$builds/linux-arm64/hub"
Copy-Item (Join-Path $PSScriptRoot '../../../hub/victory/data/layout.json') $hub
$walk = 'C:/Builds/PokeJourneys/app/generated/hubBuildAssets/hub-build/tools/hub/build/island/walk.json'
if (Test-Path $walk) { Copy-Item $walk $hub } else { Write-Host "No $walk; bot players will walk without a map." }

Write-Host "Copying the build to $Target"
Invoke-Native ssh ($ssh + @($Target, 'rm -rf /tmp/linux-arm64 /tmp/rebuild.sh'))
Invoke-Native scp ($ssh + @('-r', "$builds/linux-arm64","${Target}:/tmp/"))
Invoke-Native scp ($ssh + @((Join-Path $PSScriptRoot 'rebuild.sh'), "${Target}:/tmp/rebuild.sh"))
Write-Host 'Installing and restarting the server'
Invoke-Native ssh ($ssh + @('-o', 'LogLevel=QUIET', '-t', $Target, "sudo bash /tmp/rebuild.sh /tmp/linux-arm64 $Domain"))

# From outside, players reach the game API and the admin console is hidden.
try {
    $answer = Invoke-WebRequest "https://$Domain/api/me" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $status = [int]$answer.StatusCode
} catch { $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
try {
    Invoke-WebRequest "https://$Domain/admin/" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop | Out-Null
    $admin = 200
} catch { $admin = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
if ($status -eq 401 -and $admin -eq 404) { Write-Host "Done: https://$Domain is up and its admin console is hidden from the internet." }
elseif ($status -eq 0) { Write-Warning "Installed, but https://$Domain didn't answer from here yet (DNS or ports 80/443)." }
else { Write-Warning "Installed, but https://$Domain answered $status for the game API and $admin for /admin/ (expected 401 and 404)." }
