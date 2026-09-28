# Genera los íconos PNG de la app en /icons (sol sobre surcos).
# Uso: powershell -ExecutionPolicy Bypass -File tools/generar-iconos.ps1
Add-Type -AssemblyName System.Drawing

$destino = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $destino | Out-Null

function Nuevo-Icono([int]$tam, [double]$margen, [string]$archivo) {
  $bmp = New-Object System.Drawing.Bitmap $tam, $tam
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::FromArgb(47, 107, 58))

  # Área útil (el maskable deja zona segura)
  $m = $tam * $margen
  $s = $tam - 2 * $m

  # Sol
  $sol = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(244, 196, 64))
  $r = $s * 0.17
  $g.FillEllipse($sol, [float]($m + $s * 0.62 - $r), [float]($m + $s * 0.30 - $r), [float](2 * $r), [float](2 * $r))

  # Campo: surcos en perspectiva
  $claro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(126, 184, 104))
  $oscuro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(88, 150, 76))
  $horizonte = $m + $s * 0.52
  $abajo = $m + $s
  $n = 5
  $g.SetClip((New-Object System.Drawing.RectangleF ([float]$m, [float]$m, [float]$s, [float]$s)))
  for ($i = 0; $i -lt $n; $i++) {
    $x0 = $m + $s * (0.30 + 0.40 * $i / $n)
    $x1 = $m + $s * (0.30 + 0.40 * ($i + 1) / $n)
    $b0 = $m + $s * (-0.25 + 1.5 * $i / $n)
    $b1 = $m + $s * (-0.25 + 1.5 * ($i + 1) / $n)
    $pts = @(
      (New-Object System.Drawing.PointF ([float]$x0, [float]$horizonte)),
      (New-Object System.Drawing.PointF ([float]$x1, [float]$horizonte)),
      (New-Object System.Drawing.PointF ([float]$b1, [float]$abajo)),
      (New-Object System.Drawing.PointF ([float]$b0, [float]$abajo))
    )
    $brocha = if ($i % 2 -eq 0) { $claro } else { $oscuro }
    $g.FillPolygon($brocha, $pts)
  }

  $bmp.Save((Join-Path $destino $archivo), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Nuevo-Icono 192 0.12 'icon-192.png'
Nuevo-Icono 512 0.12 'icon-512.png'
Nuevo-Icono 512 0.22 'maskable-512.png'
Nuevo-Icono 180 0.12 'apple-touch-icon.png'
Write-Output "Íconos generados en $destino"
