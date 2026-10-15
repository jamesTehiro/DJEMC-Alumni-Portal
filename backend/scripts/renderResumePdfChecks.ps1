$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$genericAwait = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$actionAwait = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1
function Wait-PdfOperation($Operation, [Type]$ResultType) {
    $task = $genericAwait.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.GetAwaiter().GetResult()
}
function Wait-PdfAction($Operation) {
    $task = $actionAwait.Invoke($null, @($Operation))
    $null = $task.GetAwaiter().GetResult()
}
$pdfDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\tmp\pdfs\resume-checks'))
$pdfFiles = Get-ChildItem -LiteralPath $pdfDirectory -Filter '*.pdf'
foreach ($pdfFile in $pdfFiles) {
    $storageFile = Wait-PdfOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($pdfFile.FullName)) ([Windows.Storage.StorageFile])
    $document = Wait-PdfOperation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($storageFile)) ([Windows.Data.Pdf.PdfDocument])
    if ($document.PageCount -ne 2) { throw "$($pdfFile.Name): expected 2 pages, found $($document.PageCount)." }
    $page = $document.GetPage(0)
    try {
        $ratio = $page.Size.Width / $page.Size.Height
        if ([Math]::Abs($ratio - 210.0 / 297.0) -gt 0.003) { throw "$($pdfFile.Name): page proportions are not A4." }
        $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
        try {
            $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
            $options.DestinationWidth = 1000
            Wait-PdfAction ($page.RenderToStreamAsync($stream, $options))
            $stream.Seek(0)
            $managedStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
            $imagePath = Join-Path $pdfDirectory ($pdfFile.BaseName + '.png')
            $imageFile = [System.IO.File]::Create($imagePath)
            try { $managedStream.CopyTo($imageFile) } finally { $imageFile.Dispose() }
            Write-Output "PASS $($pdfFile.Name): $($document.PageCount) A4 pages; rendered first page."
        } finally { $stream.Dispose() }
    } finally { $page.Dispose() }
}
