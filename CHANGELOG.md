# Changelog

## 0.7.3 — 2026-09-28 — Actualización que quedaba trabada
- El Service Worker descarga cada archivo con `?v=VERSIÓN`: la CDN de GitHub Pages (que cachea hasta
  10 minutos) no puede entregar copias viejas. Antes, actualizar justo después de publicar podía
  guardar archivos de la versión anterior y la app quedaba en la versión vieja.
- Al instalar se verifica que `js/config.js` corresponda a la versión; si no, la instalación falla
  en lugar de quedar a medias.
- Si igual queda trabada, "Actualizar" (o "Buscar actualizaciones" en Configuración) limpia el
  Service Worker y la caché de la app y la vuelve a descargar. Los datos (IndexedDB) no se tocan.

## 0.7.2 — 2026-09-28 — Fechas en la plantilla
- La columna Fecha de la plantilla pasa a formato Texto: Excel guarda lo escrito (dd/mm/aaaa) tal cual.
  Antes, con Windows en inglés, Excel interpretaba lo escrito como mes/día/año (05/09 → 9 de mayo).
- Instrucciones de la plantilla: paso nuevo explicando cómo escribir la fecha.

## 0.7.1 — 2026-09-28 — Plantilla Excel y formulario
- La plantilla de importación ahora es un Excel (.xlsx) con dos pestañas:
  **Instrucciones** (pasos, qué va en cada columna, valores posibles, categorías/subcategorías, campañas y
  quién pagó) y **Movimientos** (tabla de Excel con filtros, encabezado fijo, formatos de fecha y número,
  listas desplegables y 3 filas de ejemplo).
- La importación lee .xlsx directamente (y sigue aceptando CSV). Las filas de ejemplo ("EJEMPLO" en
  Descripción) se ignoran solas. Fechas y números de Excel se convierten.
- Categorías con el mismo nombre como gasto y como ingreso ("Otros") se distinguen como
  "Otros (gasto)" / "Otros (ingreso)"; si viene solo "Otros", la fila pide elegir.
- Formulario de movimiento: Descripción pasa a estar entre Fecha y Categoría.
- `js/lib/zip.js` y `js/lib/xlsx.js`: generar y leer .xlsx sin librerías externas.

## 0.7.0 — 2026-09-28 — Fase 7: migración y extras
- **Importar movimientos** (Configuración): descargar plantilla CSV (con filas de ayuda y valores válidos),
  completarla en Excel y elegir el archivo. Pantalla de revisión con los errores de cada fila: se pueden
  corregir en el lugar o ignorar la fila. Posibles duplicados (misma fecha, categoría, moneda y monto)
  vienen ignorados. Sin cotización, se busca la del día. Acepta `;`, `,` o tab y números es-AR.
- **Comprobantes**: foto o PDF por movimiento, guardados en una carpeta de Drive (Script Property
  `CARPETA_COMPROBANTES`). Las fotos se achican a 1600 px antes de subir. Sin conexión quedan en cola
  (tabla `archivos`, Dexie v2) y se suben al sincronizar. 📎 en el listado abre el comprobante.
  `js/storage.js` encapsula la subida (`subir(archivo) → url`).
- **Exportar CSV** desde el listado (respeta los filtros); se puede volver a importar.
- `js/api.js`: llamadas al Apps Script compartidas por sync y storage.
- `tools/generar-migracion.py`: arma el CSV de importación desde la hoja "Movimientos" del Excel
  (queda en `migracion/`, fuera del repo). La fecha se deduce de la cotización de cada fila.
- La especificación ya no está en el repositorio.

## 0.6.0 — 2026-09-28 — Fase 6: resumen de campaña y cuentas entre hermanos
- Resumen de campaña: gastos total y por ha (ARS/USD) por categoría y subcategoría con %, ingresos
  (kg, qq, $, precio promedio por qq), margen bruto total y por ha, rinde qq/ha y ⅓ del margen por hermano.
  Los gastos sin campaña no entran en el margen.
- Cuentas entre hermanos (todos los movimientos, incluidos los sin campaña): lo que pagó cada uno
  (propio + ⅓ de la Caja común) contra lo que le corresponde, ingresos cobrados a nombre propio,
  saldo y sugerencia de transferencias para quedar a mano.
- Navegación: "Resumen" y "Cuentas" en la barra lateral (notebook) y en "Más" (celular).
- `js/calculos.js` con los cálculos como funciones puras.

## 0.5.0 — 2026-09-28 — Fase 5: listado y vistas
- Listado con filtros por campaña (Todas / Sin campaña / cada una), categoría, mes y quién pagó.
  Los filtros se conservan durante la sesión; "Limpiar filtros".
- Vista ARS / USD / Ambos, recordada por usuario. En "Ambos", la moneda original va en negrita.
- Totales del filtro: gastos, ingresos, neto y por hermano (⅓).
- Tabla a todo el ancho en notebook; tarjetas apiladas en celular. Tocar un movimiento abre la edición;
  borrar desde el listado pide confirmación.

## 0.4.0 — 2026-09-28 — Fase 4: carga de movimientos y dólar
- `js/dolar.js`: cotización de venta MEP/Oficial. Hoy desde dolarapi.com; fechas pasadas desde
  ArgentinaDatos por fecha puntual. Fines de semana y feriados (API de feriados, cacheada por año)
  usan el último día hábil, que se guarda en `tcFecha`. Cache en la tabla `cotizaciones`.
- Sin conexión: última cotización conocida con estado "a confirmar". Al volver la conexión aparece un aviso
  para recalcularlas (no se hace solo).
- Formulario de carga/edición: fecha (hoy), categoría con tipo, subcategoría filtrada, monto con toggle $/US$,
  tipo de dólar y TC editables con fecha real y equivalente en vivo, campaña precargada según la fecha
  (la más reciente si se superponen), quién pagó (Caja común por defecto), "Más datos" (descripción,
  proveedor, quintales, precio por qq y "calcular monto").
- "Guardar y cargar otro" conserva fecha, campaña, pagó, moneda y tipo de dólar.
- Borrado lógico con confirmación. Listado simple de movimientos (el completo llega en la Fase 5).
- `periodo` (AAAAMM) se deriva localmente también en los movimientos que llegan por sincronización.

## 0.3.1 — 2026-09-28 — Correcciones
- URL del Apps Script de producción en `js/config.js`. En `localhost` se usa el Apps Script simulado.
- Banner "Nueva versión" que no desaparecía: `version.json` (0.4.0) y `APP_VERSION` (0.3.0) no coincidían.
  Ahora, si después de actualizar la app sigue en otra versión, no se repite el banner por 15 minutos y
  "Buscar actualizaciones" avisa de la inconsistencia.
- `tools/verificar.mjs`: chequea versiones y precache antes de publicar.
- Zona horaria fija `America/Argentina/Buenos_Aires` para "hoy" y para mostrar horas (app y Apps Script).

## 0.3.0 — 2026-09-28 — Fase 3: Apps Script y sincronización
- `apps-script/Code.gs`: acciones `init`, `push` y `pull`; validación de clave (Script Property `CLAVE`); `LockService`;
  columnas mapeadas por encabezado y registros ubicados por `id`; `syncTs` del servidor; seed con los mismos ids que la app.
- En `push`, si el Sheet tiene una versión más nueva, la rechaza y la devuelve para que el cliente la adopte.
- `Movimientos` incluye columnas legibles de solo lectura: `periodo`, `categoriaNombre`, `subcategoriaNombre`, `campanaNombre`, `pagoNombre`.
- Fechas, ids y timestamps se guardan como texto plano (Sheets no los convierte).
- `js/sync.js`: push de pendientes → pull desde `lastSync` → merge last-write-wins por `modificado`. Timeout de 60 s.
- Disparadores: al abrir la app, al guardar (agrupa cambios 1,5 s), al volver la conexión y manual.
- Indicador en el header (sincronizado / N pendientes / sin conexión / error); tocarlo sincroniza.
- Configuración: estado, pendientes, última sincronización y "Sincronizar ahora".
- `apps-script/README.md` con la instalación paso a paso y `tools/apps-script-local.mjs` para probar sin desplegar.

## 0.2.0 — 2026-09-28 — Fase 2: base local y ABMs
- `js/db.js` con Dexie 4.4.6 (local en `/vendor`): tablas hermanos, categorías, subcategorías, campañas, movimientos, ajustes y cotizaciones.
- Seed inicial (hermanos y categorías/subcategorías) con **ids fijos**, para que la sincronización no los duplique entre dispositivos.
- Campos comunes automáticos en altas y modificaciones (`id`, `creado`, `modificado`, `cargadoPor`, `borrado`, `pendiente`); borrado lógico.
- ABM de hermanos (nombre, activo).
- ABM de categorías y subcategorías: agrupadas por tipo, alta, edición, desactivar, reordenar (↑ ↓) y borrar solo si no tienen movimientos.
- ABM de campañas con aviso de superposición de fechas.
- Configuración pasa a Dexie; los ajustes de la 0.1.0 (localStorage) se migran solos.
- Se pide almacenamiento persistente al navegador.

## 0.1.0 — 2026-09-28 — Fase 1: esqueleto PWA
- `index.html`, manifest, íconos y Service Worker con precache (funciona offline).
- Router por hash con vistas vacías: Movimientos, Nuevo, Campañas, Categorías, Hermanos, Más, Configuración.
- Layout responsive: barra inferior en celular, barra lateral en notebook; formularios centrados (máx. 560px).
- `js/config.js` y `version.json`; banner "Nueva versión disponible" al detectar otra versión (al abrir y al volver a primer plano).
- Configuración: elegir usuario (lista provisoria), clave compartida y tipo de dólar por defecto (en `localStorage` por ahora), versión y "Buscar actualizaciones".
- Si falta usuario o clave, la app abre en Configuración.
