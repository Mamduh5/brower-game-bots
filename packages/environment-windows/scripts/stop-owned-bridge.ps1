param([Parameter(Mandatory = $true)][string]$ExecutablePath)
$ErrorActionPreference = 'Stop'
$bridgePath = [System.IO.Path]::GetFullPath($ExecutablePath)
foreach ($bridgeProcess in [System.Diagnostics.Process]::GetProcessesByName('DesktopBridge')) {
    try {
        # Hold a handle before checking the path. Kill/WaitForExit then target this
        # process object, never a PID that could have been recycled after enumeration.
        try {
            $bridgeHandle = $bridgeProcess.Handle
            $actualPath = $bridgeProcess.MainModule.FileName
        } catch {
            # An inaccessible process cannot be proven to belong to this checkout.
            continue
        }
        if (![string]::Equals($actualPath, $bridgePath, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        Write-Host "Stopping repository bridge PID $($bridgeProcess.Id) for native rebuild."
        $shutdownEvent = $null
        try {
            $shutdownEvent = [System.Threading.EventWaitHandle]::OpenExisting("Local\GameBotsDesktopBridgeShutdown-$($bridgeProcess.Id)")
            [void]$shutdownEvent.Set()
        } catch [System.Threading.WaitHandleCannotBeOpenedException] {
            # Older repository binaries do not have the cooperative shutdown event.
        } finally {
            if ($null -ne $shutdownEvent) { $shutdownEvent.Dispose() }
        }
        if (!$bridgeProcess.WaitForExit(4000)) {
            Write-Host 'Repository bridge did not exit; terminating the verified process.'
            $bridgeProcess.Kill()
            if (!$bridgeProcess.WaitForExit(5000)) { throw 'Repository bridge did not terminate.' }
        }
    } catch {
        if (!$bridgeProcess.HasExited) { throw }
    } finally {
        $bridgeProcess.Dispose()
    }
}
