$filePath = "c:\Users\user\OneDrive - Department of Premier Western Cape\GitHub\wcedsessions\testarea\collections\ms-sessions-landing-page.html"
$content = Get-Content $filePath -Raw -Encoding UTF8

$content = $content -replace 'border-left-color:#8FAD15', 'border-left-color:#32CD32'
$content = $content -replace 'background:#8FAD15', 'background:#32CD32; color:white'
$content = $content -replace 'border-left-color:#007DBA', 'border-left-color:#FFD700'
$content = $content -replace 'background:#007DBA', 'background:#FFD700; color:#111827'
$content = $content -replace 'border-left-color:#C8126E', 'border-left-color:#EE3B3B'
$content = $content -replace 'background:#C8126E', 'background:#EE3B3B; color:white'
$content = $content -replace 'border-left-color:#001489', 'border-left-color:#004B87'
$content = $content -replace 'background:#001489', 'background:#004B87; color:white'

[IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)
Write-Output "Colors updated"
