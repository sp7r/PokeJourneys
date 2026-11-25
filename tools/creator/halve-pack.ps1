# Converts the character-creator art pack (Character Customization Resources (Gen 4) by Coffee Cup / Poltergeist,
# https://eeveeexpo.com/resources/317/) to its native size. The pack is drawn at double size: every pixel is a
# uniform 2x2 block, so halving it loses nothing. The native sprites are the size of the DS and GBA games' own
# overworld sprites, and the app scales them up for its own screens. Back trainer pictures become strips of 5 frames
# of 87 x 98 px. The pack's example images aren't sprites and are skipped.
#
# Usage: halve-pack.ps1 -Source "<folder of the unpacked pack>" [-Destination assets/creator/sprites]
# A file that isn't made of uniform 2x2 blocks is listed and not converted.
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$Destination = ""
)
$ErrorActionPreference = "Stop"
if (-not $Destination) { $Destination = Join-Path $PSScriptRoot "..\..\assets\creator\sprites" }
Add-Type -AssemblyName System.Drawing

$Source = (Resolve-Path $Source).Path
New-Item -ItemType Directory -Force $Destination | Out-Null
$Destination = (Resolve-Path $Destination).Path

# A pixel's color for comparison; every fully transparent pixel counts as the same (the pack stores varying hidden
# RGB values behind alpha 0).
function Get-Key($bmp, [int]$x, [int]$y) {
    $p = $bmp.GetPixel($x, $y)
    if ($p.A -eq 0) { return 0 }
    return $p.ToArgb()
}

# Halves the $w x $h doubled area of $src starting at ($sx, 0) into $dst at ($dx, 0). Returns how many 2x2 blocks
# weren't uniform; such a block takes its most common color (a few stray pixels from touch-ups at double size).
function Copy-Halved($src, $dst, [int]$sx, [int]$dx, [int]$w, [int]$h) {
    $mixed = 0
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $px = @($src.GetPixel($sx + 2 * $x, 2 * $y), $src.GetPixel($sx + 2 * $x + 1, 2 * $y),
                $src.GetPixel($sx + 2 * $x, 2 * $y + 1), $src.GetPixel($sx + 2 * $x + 1, 2 * $y + 1))
            $keys = $px | ForEach-Object { if ($_.A -eq 0) { 0 } else { $_.ToArgb() } }
            $pick = $px[0]
            if (($keys | Sort-Object -Unique).Count -gt 1) {
                $mixed++
                $top = $keys | Group-Object | Sort-Object Count -Descending | Select-Object -First 1
                $pick = $px[[array]::IndexOf($keys, $top.Values[0])]
            }
            if ($pick.A -ne 0) { $dst.SetPixel($dx + $x, $y, $pick) }
        }
    }
    return $mixed
}

# A file with more mixed blocks than this isn't a double-size drawing and is refused.
$MaxMixedBlocks = 8

# Back trainer pictures are strips of 5 frames, 175 px wide each, whose doubled art starts 1 px into the frame.
$BackFrames = 5
$BackFrameWidth = 175

$converted = 0
$refused = @()
$touchedUp = @()
foreach ($file in Get-ChildItem $Source -Recurse -File -Filter *.png | Where-Object { $_.Name -notlike 'example*' }) {
    $relative = $file.FullName.Substring($Source.Length).TrimStart('\')
    $out = Join-Path $Destination $relative
    # Already converted (a resumed run): skip.
    if (Test-Path -LiteralPath $out) { $converted++; continue }
    $src = New-Object System.Drawing.Bitmap $file.FullName
    try {
        if ($src.Height % 2 -ne 0) {
            $refused += "$relative (odd height $($src.Width)x$($src.Height))"
            continue
        }
        $h = $src.Height / 2
        $isBackStrip = $src.Width -eq $BackFrames * $BackFrameWidth
        if ($src.Width % 2 -ne 0 -and -not $isBackStrip) {
            $refused += "$relative (odd width $($src.Width)x$($src.Height))"
            continue
        }
        $mixed = 0
        $edgeArt = $false
        if ($isBackStrip) {
            $fw = ($BackFrameWidth - 1) / 2
            $dst = New-Object System.Drawing.Bitmap ($BackFrames * $fw), $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            for ($k = 0; $k -lt $BackFrames; $k++) {
                $x0 = $k * $BackFrameWidth
                # The skipped first column of each frame must be empty, or halving would drop art.
                for ($y = 0; $y -lt $src.Height; $y++) {
                    if ($src.GetPixel($x0, $y).A -ne 0) { $edgeArt = $true; break }
                }
                $mixed += Copy-Halved $src $dst ($x0 + 1) ($k * $fw) $fw $h
            }
        }
        else {
            $dst = New-Object System.Drawing.Bitmap ($src.Width / 2), $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $mixed = Copy-Halved $src $dst 0 0 ($src.Width / 2) $h
        }
        if ($edgeArt -or $mixed -gt $MaxMixedBlocks) {
            $why = if ($edgeArt) { "art in a back frame's skipped first column" } else { "$mixed mixed 2x2 blocks" }
            $refused += "$relative ($why)"
            $dst.Dispose()
            continue
        }
        if ($mixed -gt 0) { $touchedUp += "$relative ($mixed stray blocks resolved)" }
        New-Item -ItemType Directory -Force (Split-Path -LiteralPath $out) | Out-Null
        # Saved through a stream: GDI+ fails on some file names when given a path.
        try {
            $stream = [System.IO.File]::Open($out, [System.IO.FileMode]::Create)
            try { $dst.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $stream.Dispose() }
            $converted++
        }
        catch {
            $refused += "$relative (save failed: $($_.Exception.Message))"
            Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
        }
        finally { $dst.Dispose() }
    }
    finally {
        $src.Dispose()
    }
}

"Converted $converted files to $Destination"
if ($touchedUp.Count -gt 0) {
    "Converted with stray pixels resolved ($($touchedUp.Count)):"
    $touchedUp | ForEach-Object { "  $_" }
}
if ($refused.Count -gt 0) {
    "Not converted ($($refused.Count)):"
    $refused | ForEach-Object { "  $_" }
    exit 1
}
