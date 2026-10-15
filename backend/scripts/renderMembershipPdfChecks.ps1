$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$membershipGenericAwait = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$membershipActionAwait = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1
function Wait-MembershipOperation($Operation, [Type]$ResultType) {
    $membershipTask = $membershipGenericAwait.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $membershipTask.GetAwaiter().GetResult()
}
function Wait-MembershipAction($Operation) {
    $membershipTask = $membershipActionAwait.Invoke($null, @($Operation))
    $null = $membershipTask.GetAwaiter().GetResult()
}
$membershipPdfDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\tmp\pdfs\membership-checks'))
foreach ($membershipName in @('membership-standard', 'membership-overflow')) {
    $membershipPdfPath = Join-Path $membershipPdfDirectory ($membershipName + '.pdf')
    $membershipStorageFile = Wait-MembershipOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($membershipPdfPath)) ([Windows.Storage.StorageFile])
    $membershipPdf = Wait-MembershipOperation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($membershipStorageFile)) ([Windows.Data.Pdf.PdfDocument])
    if ($membershipName -eq 'membership-standard' -and $membershipPdf.PageCount -ne 2) { throw 'The standard membership form must have two A4 pages.' }
    if ($membershipName -eq 'membership-overflow' -and $membershipPdf.PageCount -le 2) { throw 'Long membership records must continue onto additional pages.' }
    foreach ($membershipPageIndex in 0..($membershipPdf.PageCount - 1)) {
        $membershipPage = $membershipPdf.GetPage($membershipPageIndex)
        try {
            $membershipRatio = $membershipPage.Size.Width / $membershipPage.Size.Height
            if ([Math]::Abs($membershipRatio - 210.0 / 297.0) -gt 0.003) { throw 'The membership page proportions are not A4.' }
            $membershipStream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
            try {
                $membershipRenderOptions = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
                $membershipRenderOptions.DestinationWidth = 1000
                Wait-MembershipAction ($membershipPage.RenderToStreamAsync($membershipStream, $membershipRenderOptions))
                $membershipStream.Seek(0)
                $membershipManagedStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($membershipStream)
                $membershipImagePath = Join-Path $membershipPdfDirectory ($membershipName + '-page-' + ($membershipPageIndex + 1) + '.png')
                $membershipImageFile = [System.IO.File]::Create($membershipImagePath)
                try { $membershipManagedStream.CopyTo($membershipImageFile) } finally { $membershipImageFile.Dispose() }
            } finally { $membershipStream.Dispose() }
        } finally { $membershipPage.Dispose() }
    }
    Write-Output "PASS $membershipName`: $($membershipPdf.PageCount) A4 pages; rendered every page for inspection."
}
