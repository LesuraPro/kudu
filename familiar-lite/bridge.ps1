# Familiar Lite: bridge to Windows.
# Prints JSON lines to stdout:
#   {"type":"media", ...}    every 500 ms - what is playing (Windows SMTC)
#   {"type":"windows", ...}  every second - open app windows and the foreground one
#   {"type":"appbar", ...}   reply to the appbar command
# Reads commands from stdin, one per line:
#   toggle | next | prev            - player controls
#   focus <hwnd>                    - bring a window up (or minimize it if it is already active)
#   appbar <hwnd> <l> <t> <r> <h>   - reserve a strip at the top of the screen (physical pixels)
#   appbar-remove <hwnd>            - give the strip back
#   wallpaper <path>                - set desktop wallpaper
# Kept ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.
# The C# below must stay C# 5 (no $"", no out var): that is what PowerShell 5.1 compiles.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class FamiliarWin {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, uint param, string value, uint flags);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);

  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int left, top, right, bottom; }

  [StructLayout(LayoutKind.Sequential)]
  struct APPBARDATA {
    public int cbSize;
    public IntPtr hWnd;
    public uint uCallbackMessage;
    public uint uEdge;
    public RECT rc;
    public IntPtr lParam;
  }

  [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);

  public class Win {
    public long hwnd;
    public string title;
    public string path;
    public uint pid;
  }

  public static string ProcessPath(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) return "";
    try {
      StringBuilder sb = new StringBuilder(1024);
      int size = sb.Capacity;
      return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
    } finally {
      CloseHandle(h);
    }
  }

  // Same rules the taskbar roughly uses: visible, titled, not owned, not a tool window, not cloaked
  static bool IsAppWindow(IntPtr h) {
    if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0) return false;
    if (GetWindow(h, 4) != IntPtr.Zero) return false; // GW_OWNER
    if ((GetWindowLong(h, -20) & 0x80) != 0) return false; // WS_EX_TOOLWINDOW
    int cloaked;
    if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false; // DWMWA_CLOAKED
    return true;
  }

  public static List<Win> List() {
    List<Win> list = new List<Win>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (IsAppWindow(h)) {
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, sb.Capacity);
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        Win w = new Win();
        w.hwnd = h.ToInt64();
        w.title = sb.ToString();
        w.pid = pid;
        w.path = ProcessPath(pid);
        list.Add(w);
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }

  // Click on a running app in the dock: restore + focus, or minimize if it is already in front
  public static void Focus(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    if (!IsWindow(h)) return;
    IntPtr fg = GetForegroundWindow();
    if (fg == h && !IsIconic(h)) {
      ShowWindow(h, 6); // SW_MINIMIZE
      return;
    }
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    // Windows only lets the foreground thread change focus, so borrow its input queue for a moment
    uint pid;
    uint fgThread = GetWindowThreadProcessId(fg, out pid);
    uint self = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != self && AttachThreadInput(self, fgThread, true);
    SetForegroundWindow(h);
    BringWindowToTop(h);
    if (attached) AttachThreadInput(self, fgThread, false);
  }

  static APPBARDATA Data(long hwnd) {
    APPBARDATA d = new APPBARDATA();
    d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    d.hWnd = new IntPtr(hwnd);
    return d;
  }

  // Reserve a strip at the top edge so maximized windows do not slide under the menubar.
  // Returns the rectangle Windows actually gave us.
  public static int[] AppBar(long hwnd, int left, int top, int right, int height) {
    APPBARDATA d = Data(hwnd);
    d.uCallbackMessage = 0x8000 + 77; // WM_APP + 77
    SHAppBarMessage(0, ref d); // ABM_NEW
    d.uEdge = 1; // ABE_TOP
    d.rc.left = left;
    d.rc.right = right;
    d.rc.top = top;
    d.rc.bottom = top + height;
    SHAppBarMessage(2, ref d); // ABM_QUERYPOS
    d.rc.bottom = d.rc.top + height;
    SHAppBarMessage(3, ref d); // ABM_SETPOS
    return new int[] { d.rc.left, d.rc.top, d.rc.right, d.rc.bottom };
  }

  public static void AppBarRemove(long hwnd) {
    APPBARDATA d = Data(hwnd);
    SHAppBarMessage(1, ref d); // ABM_REMOVE
  }

  public static bool Wallpaper(string path) {
    return SystemParametersInfo(20, 0, path, 3); // SPI_SETDESKWALLPAPER, update ini + broadcast
  }
}
'@

# ---------- Media (SMTC) ----------

$mgr = $null
try {
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
} catch {
  # Old Windows 10 builds have no SMTC - the rest of the bridge still works
  [Console]::Error.WriteLine("media unavailable: $_")
}

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

$lastKey = ''

function Get-MediaState {
  $state = @{ type = 'media'; status = 'none' }
  if (-not $mgr) { return $state }
  $session = $mgr.GetCurrentSession()
  if (-not $session) { return $state }
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
      type     = 'media'
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
    if ($state.key -ne $script:lastKey) {
      $script:lastKey = $state.key
      $state.art = Read-Art $props
    }
  } catch {
    $state = @{ type = 'media'; status = 'none' }
  }
  return $state
}

function Invoke-Media($cmd) {
  if (-not $mgr) { return }
  $session = $mgr.GetCurrentSession()
  if (-not $session) { return }
  switch ($cmd) {
    'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
    'next' { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
    'prev' { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
  }
}

# ---------- Main loop ----------

function Send($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

$appbars = @{}

function Invoke-BridgeCommand($line) {
  $parts = $line.Trim() -split ' ', 2
  $arg = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  switch ($parts[0]) {
    { $_ -in 'toggle', 'next', 'prev' } { Invoke-Media $_ }
    'focus' { [FamiliarWin]::Focus([long]$arg) }
    'appbar' {
      $a = $arg -split ' '
      $rc = [FamiliarWin]::AppBar([long]$a[0], [int]$a[1], [int]$a[2], [int]$a[3], [int]$a[4])
      $script:appbars[$a[0]] = $true
      Send @{ type = 'appbar'; hwnd = $a[0]; rect = $rc }
    }
    'appbar-remove' {
      [FamiliarWin]::AppBarRemove([long]$arg)
      $script:appbars.Remove($arg)
    }
    'wallpaper' { $null = [FamiliarWin]::Wallpaper($arg) }
  }
}

# Console.In.ReadLineAsync blocks in .NET Framework, a raw StreamReader does not
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$tick = 0
$mediaStatus = 'none'
$mediaNow = $true
$lastWindows = ''

while ($true) {
  while ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) {
      # stdin closed: the app has quit (or crashed) - give the screen strip back
      foreach ($h in @($appbars.Keys)) { [FamiliarWin]::AppBarRemove([long]$h) }
      exit
    }
    try { Invoke-BridgeCommand $line } catch { [Console]::Error.WriteLine("command '$line' failed: $_") }
    # After a play/pause/next click, report the new state right away
    $mediaNow = $true
    $pending = $stdin.ReadLineAsync()
  }

  # Media: twice a second while playing, every 2 seconds when paused or silent
  $mediaEvery = 8
  if ($mediaStatus -eq 'playing') { $mediaEvery = 2 }
  if ($mediaNow -or $tick % $mediaEvery -eq 0) {
    $m = Get-MediaState
    $mediaStatus = $m.status
    $mediaNow = $false
    Send $m
  }

  # Windows: checked every second, sent only when something changed
  if ($tick % 4 -eq 0) {
    try {
      $list = @([FamiliarWin]::List() | ForEach-Object { @{ hwnd = $_.hwnd; title = $_.title; path = $_.path; pid = $_.pid } })
      $json = (@{ type = 'windows'; list = $list; foreground = [FamiliarWin]::GetForegroundWindow().ToInt64() } | ConvertTo-Json -Compress -Depth 4)
      if ($json -ne $lastWindows) {
        $lastWindows = $json
        [Console]::Out.WriteLine($json)
        [Console]::Out.Flush()
      }
    } catch {
      [Console]::Error.WriteLine("windows failed: $_")
    }
  }
  $tick++
  Start-Sleep -Milliseconds 250
}
