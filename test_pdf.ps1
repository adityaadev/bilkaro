$signup = Invoke-RestMethod -Method Post -Uri 'http://localhost:4000/api/auth/login' -ContentType 'application/json' -Body (@{ email='retail10@test.com'; password='password123' } | ConvertTo-Json)
$token = $signup.token
$headers = @{ Authorization = 'Bearer ' + $token }
$webRequest = [System.Net.WebRequest]::Create('http://localhost:4000/api/invoices/35/pdf')
$webRequest.Method = 'POST'
$webRequest.Headers.Add('Authorization', 'Bearer ' + $token)
$webRequest.ContentLength = 0
try {
    $response = $webRequest.GetResponse()
    $stream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $content = $reader.ReadToEnd()
    "Response length: " + $content.Length
    "Content-Type: " + $response.ContentType
    [System.IO.File]::WriteAllBytes('invoice_35.pdf', [System.Text.Encoding]::Default.GetBytes($content))
    "File size: " + (Get-Item invoice_35.pdf).Length
} catch {
    "Error: " + $_.Exception.Message
    if ($_.Exception.Response) {
        $errStream = $_.Exception.Response.GetResponseStream()
        $errReader = New-Object System.IO.StreamReader($errStream)
        $errContent = $errReader.ReadToEnd()
        "Error response: " + $errContent
    }
}