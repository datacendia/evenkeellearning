# Quick HTTP smoke test for the dev server. Run while `npm run dev` is up.
$paths = @('/','/student','/teacher','/parent','/compliance','/adult','/trades','/auth','/this-is-not-a-route')
foreach ($p in $paths) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000$p" -UseBasicParsing -TimeoutSec 8
        Write-Host "$p => $($r.StatusCode)"
    } catch [System.Net.WebException] {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { '???' }
        Write-Host "$p => $code"
    } catch {
        Write-Host "$p => ERR $($_.Exception.Message)"
    }
}
