param(
    [Parameter(Mandatory=$true)][string]$Image,
    [Parameter(Mandatory=$true)][string]$Out,
    [int]$Column=5, [int]$Row=14, [int]$Columns=2, [int]$Rows=2,
    [int]$Tile=256
)
$ErrorActionPreference='Stop'
$dest=[IO.Path]::GetFullPath($Out)
if (!$dest.StartsWith('C:\Projects\hub-work\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be under C:\Projects\hub-work\' }
Add-Type -AssemblyName System.Drawing
$source=[Drawing.Bitmap]::FromFile([IO.Path]::GetFullPath($Image))
try {
    $rect=[Drawing.Rectangle]::new($Column*$Tile,$Row*$Tile,$Columns*$Tile,$Rows*$Tile)
    $crop=$source.Clone($rect,$source.PixelFormat)
    try {$crop.Save($dest,[Drawing.Imaging.ImageFormat]::Png)} finally {$crop.Dispose()}
} finally {$source.Dispose()}
