# PowerShell script to unzip all zip files from a source directory into unique folders in a destination directory
$sourceDir = "C:\Users\vvsit\Downloads\channel\Done"
$destDir = "C:\Users\vvsit\Downloads\channel\Extracted"

if (!(Test-Path $sourceDir)) {
    Write-Error "Source directory not found: $sourceDir"
    exit 1
}

if (!(Test-Path $destDir)) {
    Write-Host "Creating destination directory: $destDir"
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

$zipFiles = Get-ChildItem -Path $sourceDir -Filter *.zip
Write-Host "Found $($zipFiles.Count) zip file(s) in $sourceDir"

foreach ($zip in $zipFiles) {
    $folderName = $zip.BaseName
    $targetPath = Join-Path $destDir $folderName
    
    Write-Host "--------------------------------------------------"
    Write-Host "Extracting $($zip.Name) -> $targetPath"
    
    try {
        if (!(Test-Path $targetPath)) {
            New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
        }
        Expand-Archive -Path $zip.FullName -DestinationPath $targetPath -Force
        Write-Host "Successfully extracted: $($zip.Name)"
    } catch {
        Write-Error "Failed to extract $($zip.Name): $_"
    }
}

Write-Host "--------------------------------------------------"
Write-Host "Extraction complete!"
