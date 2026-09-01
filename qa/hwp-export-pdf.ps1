param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)

if ([IO.Path]::GetExtension($resolvedInput).ToLowerInvariant() -ne '.hwpx') {
    throw "입력 파일은 HWPX여야 합니다: $resolvedInput"
}
if ([IO.Path]::GetExtension($resolvedOutput).ToLowerInvariant() -ne '.pdf') {
    throw "출력 파일은 PDF여야 합니다: $resolvedOutput"
}

$outputDirectory = [IO.Path]::GetDirectoryName($resolvedOutput)
if (-not [IO.Directory]::Exists($outputDirectory)) {
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
}

$hwp = $null
try {
    $hwp = New-Object -ComObject 'HWPFrame.HwpObject'
    try { $hwp.XHwpWindows.Item(0).Visible = $false } catch {}
    try { $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') } catch {}
    $opened = $hwp.Open($resolvedInput, 'HWPX', 'forceopen:true')
    if (-not $opened) { throw "한컴오피스가 HWPX를 열지 못했습니다." }
    $saved = $hwp.SaveAs($resolvedOutput, 'PDF', '')
    if (-not $saved -or -not (Test-Path -LiteralPath $resolvedOutput)) {
        throw "한컴오피스가 PDF를 저장하지 못했습니다."
    }
    Get-Item -LiteralPath $resolvedOutput | Select-Object FullName, Length, LastWriteTime
} finally {
    if ($null -ne $hwp) {
        try { $hwp.Clear(1) } catch {}
        try { $hwp.Quit() } catch {}
        try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp) | Out-Null } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
