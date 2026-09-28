# Campo Adela

PWA para registrar gastos e ingresos del campo familiar.

Sin build step: HTML + CSS + JavaScript (ES modules). Se publica tal cual en GitHub Pages.

## Desarrollo local

```bash
node tools/servidor.mjs
```

Abrir http://localhost:8080. El Service Worker cachea todo: para ver cambios sin cambiar
la versión, en DevTools → Application → Service Workers marcar **Update on reload**
(o usar una ventana de incógnito).

## Backend (Google Sheet + Apps Script)

Instalación paso a paso en [apps-script/README.md](apps-script/README.md).
Para probar la sincronización sin desplegar: `node tools/apps-script-local.mjs` (ver ese README).

## Publicar una versión nueva

1. Subir la versión en `version.json` **y** en `js/config.js` (`APP_VERSION`), con el mismo valor.
   Si no coinciden, la app muestra el banner "Nueva versión" y no puede actualizarse.
2. Si se agregaron archivos, sumarlos a `ASSETS` en `sw.js`.
3. Agregar la entrada en `CHANGELOG.md`.
4. Verificar: `node tools/verificar.mjs` (versiones iguales y precache completo).
5. Push a `main` (GitHub Pages publica desde la raíz; la CDN puede tardar unos minutos).

En `localhost` la app sincroniza contra el Apps Script simulado (`node tools/apps-script-local.mjs`),
nunca contra el Sheet real.

Los usuarios con la app abierta ven el banner **"Nueva versión disponible — Actualizar"**.
Actualizar nunca borra los datos locales (IndexedDB).

## Íconos

`powershell -ExecutionPolicy Bypass -File tools/generar-iconos.ps1` regenera los PNG de `/icons`.
