# Opens the Oracle server's admin console on this PC through an SSH tunnel; the console isn't on the internet.
#   powershell -File server/journeys-server/deploy/admin.ps1 [-CopyKey] [-App]
# Uses the target saved by deploy.ps1 (or -Target user@VM_IP). -CopyKey puts the admin key on the clipboard.
# Without -App the tunnel has its own window (close it to disconnect) and the console opens in the browser.
# -App is for a desktop shortcut: the tunnel runs hidden, the console opens in its own Edge app window, and closing
# that window closes the tunnel. -Shortcut makes that "PokeJourneys Admin" shortcut on the desktop.
param(
    [string]$Target,
    [string]$Key,
    [int]$Port = 15280,
    [switch]$CopyKey,
    [switch]$App,
    [switch]$Shortcut
)

$ErrorActionPreference = 'Stop'

if ($Shortcut) {
    # The shortcut carries the server and key itself, so it works without deploy.ps1's saved settings.
    $saved = Join-Path $env:LOCALAPPDATA 'PokeJourneysDeploy/oracle.json'
    $known = if (Test-Path -LiteralPath $saved) { Get-Content -Raw -LiteralPath $saved | ConvertFrom-Json } else { $null }
    if (-not $Target -and $known) { $Target = $known.target }
    if (-not $Key -and $known) { $Key = $known.key }
    if (-not $Target) { throw 'Give -Target user@VM_IP (and -Key path\to\key) to make the shortcut.' }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'PokeJourneys Admin.lnk'))
    $link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -CopyKey -App -Target $Target" + $(if ($Key) { " -Key `"$Key`"" } else { '' })
    $link.WorkingDirectory = $PSScriptRoot
    $link.Description = 'PokeJourneys server admin console (Oracle, through an SSH tunnel)'
    $link.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',13'
    $link.Save()
    Write-Host 'Made "PokeJourneys Admin" on the desktop.'
    return
}

function Show-Problem([string]$text) {
    if ($App) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($text, 'PokeJourneys Admin', 'OK', 'Error') | Out-Null
    } else { Write-Error $text }
}

$tunnel = $null
try {
    $settingsPath = Join-Path $env:LOCALAPPDATA 'PokeJourneysDeploy/oracle.json'
    $settings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json } else { $null }
    if (-not $Target -and $settings) { $Target = $settings.target }
    if (-not $Key -and $settings) { $Key = $settings.key }
    if (-not $Target) { throw 'Give -Target user@VM_IP, or run deploy.ps1 once.' }
    $ssh = @('-o', 'ServerAliveInterval=15', '-o', 'ExitOnForwardFailure=yes')
    if ($Key) { $ssh += @('-i', "`"$Key`"") }

    function Test-Console {
        try { Invoke-WebRequest "http://127.0.0.1:$Port/admin/" -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
    }

    if (-not (Test-Console)) {
        Write-Host "Opening a tunnel to $Target (port $Port on this PC)"
        # Hidden for the shortcut (no prompts possible, so it never waits for an answer); its own window otherwise.
        $tunnel = if ($App) { Start-Process ssh -PassThru -WindowStyle Hidden -ArgumentList ($ssh + @('-o', 'BatchMode=yes', '-N', '-L', "${Port}:127.0.0.1:5280", $Target)) }
            else { Start-Process ssh -PassThru -ArgumentList ($ssh + @('-N', '-L', "${Port}:127.0.0.1:5280", $Target)) }
        for ($i = 0; $i -lt 40 -and -not (Test-Console) -and -not $tunnel.HasExited; $i++) { Start-Sleep -Milliseconds 500 }
        if (-not (Test-Console)) { throw "Couldn't reach the server's admin console through SSH ($Target). Check the internet connection and that the server is running." }
    }
    if ($CopyKey) {
        $sshKey = if ($Key) { @('-i', $Key) } else { @() }
        $adminKey = (& ssh -o BatchMode=yes @sshKey $Target 'sudo cat /var/lib/pokejourneys/admin-key.txt' | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or -not $adminKey) { throw 'Could not read the admin key on the server.' }
        Set-Clipboard -Value $adminKey.Trim()
        Write-Host 'Admin key copied to the clipboard.'
    }
    $url = "http://127.0.0.1:$Port/admin/"
    if (-not $App) {
        Start-Process $url
        Write-Host "Admin console: $url"
        return
    }
    # Its own Edge profile, so this window is a separate Edge that runs until it is closed.
    $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $edge) { throw 'Microsoft Edge was not found.' }
    $edgeProfile = Join-Path $env:LOCALAPPDATA 'PokeJourneysAdmin\edge'
    Start-Process $edge -Wait -ArgumentList @("--app=$url", "--user-data-dir=`"$edgeProfile`"", '--no-first-run', '--window-size=1280,860')
} catch {
    Show-Problem $_.Exception.Message
} finally {
    if ($App -and $tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
}
