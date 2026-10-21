# Familiar Lite: "now playing" bridge for Windows.
# Reads the system media session (Spotify, browsers, Yandex Music, etc.) via
# Windows SMTC, prints one JSON line every 500 ms and accepts commands on stdin:
# toggle | next | prev
# Kept ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
  ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$playingStatus = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing

# Console.In.ReadLineAsync blocks in .NET Framework, a raw StreamReader does not
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastKey = ''

function Read-Art($props) {
  if (-not $props.Thumbnail) { return '' }
  try {
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $net.Dispose()
    $type = if ($stream.ContentType) { $stream.ContentType } else { 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($ms.ToArray())
  } catch {
    return ''
  }
}

while ($true) {
  $session = $mgr.GetCurrentSession()

  if ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit } # stdin closed: the app has quit
    if ($session) {
      try {
        switch ($cmd.Trim()) {
          'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
          'next' { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
          'prev' { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
        }
      } catch {}
    }
    $pending = $stdin.ReadLineAsync()
  }

  $state = @{ status = 'none' }
  if ($session) {
    try {
      $props = Await ($session.TryGetMediaPropertiesAsync()) `
        ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $session.GetTimelineProperties()
      $playing = $session.GetPlaybackInfo().PlaybackStatus -eq $playingStatus

      # Apps only update the position now and then, so extrapolate it to "now"
      $pos = $tl.Position.TotalSeconds
      if ($playing -and $tl.LastUpdatedTime.Year -gt 2000) {
        $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
      }
      $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
      if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }

      $status = 'paused'
      if ($playing) { $status = 'playing' }

      $state = @{
        status   = $status
        title    = $props.Title
        artist   = $props.Artist
        album    = $props.AlbumTitle
        app      = $session.SourceAppUserModelId
        position = [math]::Round($pos, 1)
        duration = [math]::Round($dur, 1)
        key      = "$($props.Title)|$($props.Artist)"
      }
      # Cover art is heavy, send it only when the track changes
      if ($state.key -ne $lastKey) {
        $lastKey = $state.key
        $state.art = Read-Art $props
      }
    } catch {
      $state = @{ status = 'none' }
    }
  }

  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}
