param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-Result($Operation, $ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.GetAwaiter().GetResult()
}
$file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
    $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
        $language = New-Object Windows.Globalization.Language('zh-Hans-CN')
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        if ($null -eq $engine) { throw 'Windows Chinese OCR language pack is missing. Install Chinese (Simplified) language OCR in Windows Settings.' }
        $result = Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $lines = @($result.Lines | ForEach-Object {
            $words = @($_.Words)
            $left = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
            $top = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
            $right = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
            $bottom = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
            @{text=$_.Text; left=$left; top=$top; right=$right; bottom=$bottom}
            # OCR may put adjacent home shortcuts on one line. Keep precise word
            # rectangles for actionable phrases instead of clicking the line center.
            $joined = ''
            $spans = @($words | ForEach-Object {
                $wordText = $_.Text -replace '\s+', ''
                $start = $joined.Length
                $joined += $wordText
                @{start=$start; end=$joined.Length; rect=$_.BoundingRect}
            })
            $pattern = '\u9886\u6dd8\u91d1\u5e01|\u53bb\u8d5a\u80fd\u91cf|\u53bb\u5b8c\u6210|\u4e0b(?:\u4e00)?\u4e2a\u4efb\u52a1'
            foreach ($match in [regex]::Matches($joined, $pattern)) {
                if ($match.Value -eq $joined) { continue }
                $parts = @($spans | Where-Object { $_.end -gt $match.Index -and $_.start -lt ($match.Index + $match.Length) })
                if ($parts.Count -eq 0) { continue }
                # Only act when phrase boundaries align with recognized words.
                if ($parts[0].start -ne $match.Index -or $parts[-1].end -ne ($match.Index + $match.Length)) { continue }
                @{
                    text=$match.Value
                    left=($parts | ForEach-Object {$_.rect.X} | Measure-Object -Minimum).Minimum
                    top=($parts | ForEach-Object {$_.rect.Y} | Measure-Object -Minimum).Minimum
                    right=($parts | ForEach-Object {$_.rect.X + $_.rect.Width} | Measure-Object -Maximum).Maximum
                    bottom=($parts | ForEach-Object {$_.rect.Y + $_.rect.Height} | Measure-Object -Maximum).Maximum
                }
            }
        })
        ConvertTo-Json -InputObject $lines -Compress -Depth 4
    } finally { if ($bitmap) { $bitmap.Dispose() } }
} finally { $stream.Dispose() }
