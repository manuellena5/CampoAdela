# App "Campo" — Especificación para Claude Code

> **Cómo usar este documento**
> Guardalo en la raíz del repo como `SPEC.md`. En cada sesión de Claude Code pedí una sola fase:
> *"Leé SPEC.md e implementá **solo la Fase N**. No avances a la siguiente. Al terminar, listá qué probar manualmente."*

---

## 0. Contexto

PWA para que 3 hermanos (**Matias, Martin, Manuel**) registren gastos e ingresos del campo familiar: 20 ha en Landeta, Santa Fe. Los gastos y resultados se reparten en partes iguales (1/3 cada uno).

Los datos se guardan localmente y se sincronizan con un **Google Sheet nuevo** a través de **Google Apps Script**.

Se usa desde el celular (en el campo, a veces sin señal) y desde la notebook.

## 1. Reglas generales para Claude Code

- Implementá **solo la fase pedida**. Cada fase termina con la app funcionando y desplegable.
- Al cerrar cada fase:
  - incrementá la versión en `version.json` y en `js/config.js`;
  - agregá una entrada en `CHANGELOG.md`;
  - listá los pasos de prueba manual.
- No cambies el modelo de datos de una fase anterior sin avisar. Si hace falta, agregá una migración de Dexie (`db.version(n+1)`).
- Código en español para el dominio (nombres de entidades, textos de UI). Comentarios breves.
- Sin frameworks pesados ni build step: debe poder publicarse tal cual en GitHub Pages.

## 2. Stack

- HTML + CSS + **JavaScript vanilla con ES modules**, sin bundler.
- **Dexie.js** para IndexedDB. Se incluye como archivo local en `/vendor`, no por CDN, para que funcione offline.
- SPA con **router por hash** (`#/movimientos`, `#/movimientos/nuevo`, `#/campanas`, …).
- **Service Worker** propio con precache de todos los assets (offline-first).
- Hosting en **GitHub Pages**. Backend en un único deploy de **Google Apps Script** (Web App) sobre el Sheet.
- UUID v4 generado en el cliente (`crypto.randomUUID()`).

### Estructura sugerida
```
/index.html
/manifest.webmanifest
/sw.js
/version.json
/css/app.css
/js/config.js        ← URL del Apps Script, versión, defaults
/js/app.js           ← bootstrap + router
/js/db.js            ← Dexie: esquema y migraciones
/js/sync.js
/js/dolar.js
/js/ui/…             ← una vista por pantalla
/js/lib/…            ← formato de moneda/fecha, helpers
/vendor/dexie.min.js
/apps-script/Code.gs ← código del backend (se copia a mano al editor de Apps Script)
/icons/…
```

## 3. Configuración fija y datos del usuario

- `js/config.js` contiene, **hardcodeado en el código**:
  - `APPS_SCRIPT_URL`
  - `APP_VERSION`
  - `TIPO_DOLAR_DEFAULT = 'MEP'`
  - `HECTAREAS_DEFAULT = 20`

  Así sobrevive a un borrado de caché y nadie tiene que cargarlo.
- Datos locales (en IndexedDB, tabla `ajustes`):
  - **usuario**: se elige de la lista de hermanos, no se escribe;
  - **clave compartida**;
  - última cotización conocida;
  - `lastSync`.
- Si falta el usuario o la clave, la app abre en **Configuración** y no deja cargar movimientos hasta completarlos.
- **Clave compartida:**
  - se ingresa una vez;
  - viaja en cada request al Apps Script;
  - el script la valida contra una Script Property (`CLAVE`);
  - si es incorrecta, responde error y la app lo muestra.

## 4. Versionado y actualizaciones

- `version.json` = `{ "version": "1.3.0", "fecha": "2026-10-05" }`.
- El nombre del cache del SW incluye la versión (`campo-v1.3.0`).
- Al iniciar la app y cada vez que vuelve a primer plano (`visibilitychange`), se hace `fetch('version.json', {cache:'no-store'})`.
- Si la versión difiere de `APP_VERSION`, aparece un banner fijo: **"Nueva versión disponible — Actualizar"**. Al tocarlo:
  1. `registration.waiting.postMessage('SKIP_WAITING')`;
  2. recarga.
- Configuración muestra la versión actual y un botón "Buscar actualizaciones".
- **Nunca** se borra IndexedDB al actualizar.

## 5. Modelo de datos

Todas las entidades comparten estos campos:

| Campo | Descripción |
|---|---|
| `id` | UUID |
| `creado` | fecha ISO |
| `modificado` | fecha ISO |
| `cargadoPor` | usuario |
| `borrado` | booleano, para borrado lógico |
| `pendiente` | booleano, solo local: falta sincronizar |

**Todas las relaciones son por `id`, nunca por nombre.** Renombrar una categoría, campaña o hermano no rompe nada.

### hermanos
- `id`, `nombre`, `activo`.
- Seed inicial con ids fijos: Matias, Martin, Manuel.

### categorias
- `id`, `nombre`, `tipo` (`gasto` | `ingreso`), `orden`, `activa`.

### subcategorias
- `id`, `categoriaId`, `nombre`, `orden`, `activa`.

### campanas
- `id`, `nombre` (ej. "Soja 25-26"), `cultivo`, `fechaInicio`, `fechaFin`, `hectareas` (default 20), `estado` (`planificada` | `en curso` | `cerrada`), `notas`.

### movimientos

| Campo | Tipo | Notas |
|---|---|---|
| fecha | `YYYY-MM-DD` | `periodo` (AAAAMM) se deriva |
| categoriaId | ref | define si es gasto o ingreso |
| subcategoriaId | ref, opcional | |
| campanaId | ref, opcional | vacío = gasto general del campo |
| descripcion | texto | |
| proveedor | texto, opcional | contratista, agronomía, acopio, comprador |
| moneda | `ARS` \| `USD` | moneda en que se cargó |
| montoOriginal | número > 0 | |
| tipoDolar | `MEP` \| `OFICIAL` | |
| tc | número | cotización usada |
| tcFecha | fecha | día real de la cotización (puede ser el hábil anterior) |
| tcEstado | `api` \| `manual` \| `a_confirmar` | |
| montoARS | número | calculado y guardado |
| montoUSD | número | calculado y guardado |
| quintales | número, opcional | ventas, alquiler, cosecha |
| precioQq | número, opcional | precio pizarra, carga manual |
| pagoId | hermanoId o `CAJA` | default **Caja común** |
| comprobanteUrl | texto, opcional | Fase 7 |

### ajustes (solo local)
- clave/valor.

### cotizaciones (cache local)
- `[tipo+fecha]`, `valor`, `fechaReal`.

### Categorías iniciales (seed)
- **Gastos:**
  - Alquiler
  - Insumos → Semilla, Herbicidas, Fertilizante, Otros
  - Servicios → Siembra, Pulverización, Cosecha, Flete
  - Seguro
  - Honorarios ingeniero
  - Impuestos → Monotributo, Contrato, Otros
  - Obras / mant. campo
  - Otros
- **Ingresos:**
  - Venta de grano
  - Indemnización seguro
  - Otros

## 6. Cotización del dólar (`js/dolar.js`)

- Tipos: **MEP** (por defecto) y **Oficial**. Se usa el valor de **venta**.
- **Día de hoy:** `https://dolarapi.com/v1/dolares/bolsa` (MEP) y `https://dolarapi.com/v1/dolares/oficial`.
- **Fechas anteriores:** API de ArgentinaDatos (`https://api.argentinadatos.com/v1/cotizaciones/dolares/{casa}`, con casas `bolsa` y `oficial`).
  - ⚠️ Verificá en la documentación actual los endpoints exactos y si existe consulta por fecha puntual.
  - Si no existe, descargá el histórico de la casa una vez, guardalo en la tabla `cotizaciones` y actualizalo en forma incremental.
- Si la fecha no tiene cotización (fin de semana o feriado), se usa la **del último día hábil anterior** y se guarda esa fecha en `tcFecha`.
- **Sin conexión:** se usa la última cotización guardada del tipo elegido, con `tcEstado = 'a_confirmar'` y un indicador visual en el listado. Al recuperar conexión, la app ofrece recalcular los movimientos "a confirmar", sin hacerlo automáticamente.
- El TC es **siempre editable**. Si el usuario lo modifica, `tcEstado = 'manual'`.
- Cálculo:
  - si `moneda = USD`: `montoUSD = montoOriginal`, `montoARS = montoOriginal × tc`;
  - si `moneda = ARS`: al revés.
- Las conversiones usan **el TC guardado en el movimiento**, nunca el de hoy.

## 7. Sincronización con Google Sheets

### Sheet (nuevo)
- Una pestaña por entidad: `Hermanos`, `Categorias`, `Subcategorias`, `Campanas`, `Movimientos`.
- Fila 1 = encabezados con los nombres de campo del modelo.
- El script **mapea columnas por nombre de encabezado**, no por posición, así se pueden agregar o reordenar columnas.
- Cada registro se ubica por `id`, nunca por número de fila.
- `Movimientos` incluye además columnas legibles de solo lectura para quien mire el Sheet a mano (`categoriaNombre`, `campanaNombre`, `pagoNombre`, `periodo`). El script las completa al escribir y se ignoran al leer.
- Columna extra `syncTs` (timestamp del servidor) en todas las pestañas.

### Apps Script (`apps-script/Code.gs`)
- Entrada:
  - `doPost(e)` recibe `{ clave, accion, datos }`;
  - el cliente envía con `Content-Type: text/plain` para evitar el preflight de CORS.
- Acciones:
  - `push`: recibe `{ entidad: [registros] }`. Upsert por `id`, **gana el `modificado` más reciente**. Setea `syncTs`.
  - `pull`: recibe `{ desde: syncTs }`. Devuelve los registros con `syncTs > desde` de todas las entidades, más el `syncTs` actual del servidor.
  - `init`: crea las pestañas y encabezados si no existen y carga el seed.
- Usa `LockService` para evitar escrituras concurrentes.
- Validación de la clave contra la Script Property `CLAVE`.
- Respuestas JSON: `{ ok, error?, datos? }`.

### Cliente (`js/sync.js`)
- Cada alta o modificación local marca `pendiente = true` y actualiza `modificado`.
- Ciclo de sync:
  1. `push` de los pendientes;
  2. `pull` desde `lastSync`;
  3. merge (last-write-wins por `modificado`);
  4. se guarda `lastSync`.
- Disparadores:
  - al abrir la app;
  - al guardar (si hay conexión);
  - evento `online`;
  - botón manual "Sincronizar".
- En el header: indicador de estado (sincronizado / N pendientes / sin conexión / error).
- **Borrado lógico:** `borrado = true` se sincroniza como cualquier cambio; nunca se eliminan filas del Sheet.
- Cualquiera puede editar o borrar cualquier registro.

## 8. Pantallas

### Layout y responsive
- **Formularios centrados**, con `max-width: 560px` en notebook. En celular, ancho completo con padding.
- **Tablas a todo el ancho** en notebook. En celular se muestran como tarjetas apiladas.
- Navegación:
  - celular: barra inferior con Movimientos, **+ Nuevo** (destacado), Campañas, Más;
  - notebook: barra lateral o superior.
- Inputs grandes y teclado numérico (`inputmode="decimal"`) en montos.
- Formato es-AR: `$ 1.234.567,89`, `US$ 1.234,56`, fechas `dd/mm/aaaa`.

### Configuración
- Elegir usuario (lista de hermanos).
- Clave compartida.
- Tipo de dólar por defecto (MEP / Oficial).
- Versión y "Buscar actualizaciones".
- Estado de sync y "Sincronizar ahora".

### Movimientos — carga / edición (prioridad: rapidez)
- **Campos visibles:** fecha (hoy por defecto), categoría, subcategoría, monto con toggle **ARS / USD**, campaña, pagó.
- **Categoría:** selector con indicación de tipo gasto/ingreso. La subcategoría se filtra según la categoría.
- **Tipo de dólar y TC:** se muestran debajo del monto, precargados y editables, con la fecha real de la cotización y el equivalente en la otra moneda en vivo.
- **Campaña:** se **precarga la campaña cuya fecha de inicio/fin contiene la fecha elegida**. Opción "Sin campaña".
- **Pagó:** Caja común (default) / Matias / Martin / Manuel.
- **"Más datos"** (colapsado): descripción, proveedor, quintales y precio por qq (con botón "calcular monto = qq × precio").
- Al cambiar la fecha o el tipo de dólar, se vuelve a buscar la cotización.

### Movimientos — listado
- Filtros: campaña (incluye "Sin campaña" y "Todas"), categoría, mes/período, quién pagó.
- **Selector de vista: ARS / USD / Ambos.** Se recuerda por usuario.
- Totales del filtro: gastos, ingresos, neto y por hermano (1/3).
- Tocar una fila abre la edición. Borrar pide confirmación.

### Campañas — ABM
- Campos: nombre, cultivo, fecha inicio, fecha fin, hectáreas, estado, notas.
- Aviso si dos campañas se superponen en fechas: se permite, pero la precarga elige la más reciente.

### Categorías y subcategorías — ABM
- Lista de categorías agrupada por tipo, con sus subcategorías anidadas.
- Alta, edición, desactivar y reordenar.
- **No se permite borrar** si tiene movimientos asociados; solo desactivar.

### Hermanos — ABM simple
- Nombre y activo.

### Resumen de campaña (Fase 6)
- Gasto total y **por ha**, en ARS y USD, por categoría y subcategoría.
- Ingresos (kg, qq, $), margen bruto y rinde qq/ha.
- Los gastos sin campaña **no** entran en el margen.

### Cuentas entre hermanos (Fase 6)
- Por hermano: lo que pagó contra lo que le corresponde (1/3 del total, **incluidos los gastos sin campaña**).
- Saldo de cada uno y sugerencia de quién le debe a quién.
- Lo pagado por "Caja común" se reparte en tercios y no genera saldo.

## 9. Fases

Cada fase debe quedar funcionando antes de pasar a la siguiente.

### Fase 1 — Esqueleto PWA
- `index.html`, manifest, íconos, service worker con precache, router por hash, layout responsive (nav celular/notebook) y vistas vacías.
- `config.js`, `version.json` y banner de actualización.
- Pantalla Configuración: elegir usuario de una lista fija provisoria y clave. Todavía se guarda en `localStorage`; en la Fase 2 pasa a Dexie.
- **Prueba:**
  - se instala en el celular y abre offline;
  - cambiar la versión muestra el banner;
  - en notebook los formularios se ven centrados.

### Fase 2 — Base local y ABMs
- `db.js` con Dexie: todas las tablas del punto 5, índices y seed.
- ABM de hermanos, categorías y subcategorías, y campañas.
- Configuración pasa a leer y guardar en Dexie.
- **Prueba:**
  - crear, editar y desactivar registros offline;
  - renombrar una categoría no rompe referencias.

### Fase 3 — Apps Script y sincronización
- `apps-script/Code.gs` completo (init, push, pull, clave, lock) e instrucciones paso a paso en `apps-script/README.md`: crear el Sheet, pegar el código, cargar la Script Property `CLAVE`, desplegar como Web App (ejecutar como yo, acceso: cualquiera) y copiar la URL a `config.js`.
- `sync.js` e indicador de estado.
- **Prueba:**
  - dos navegadores distintos ven los mismos datos;
  - una edición offline se sube al volver la conexión;
  - un conflicto resuelve por último `modificado`.

### Fase 4 — Carga de movimientos y dólar
- `dolar.js` (hoy, histórico, fin de semana, offline, cache) y formulario de carga/edición de movimientos completo.
- **Prueba:**
  - cargar en ARS y en USD;
  - una fecha de sábado toma el viernes;
  - una fecha pasada trae su cotización;
  - modo avión → "a confirmar";
  - TC editable.

### Fase 5 — Listado y vistas
- Listado con filtros, vista ARS / USD / Ambos, totales, tabla en notebook y tarjetas en celular.

### Fase 6 — Resumen de campaña y cuentas entre hermanos

### Fase 7 — Migración y extras
- **Importación inicial** (acción `importar` en el script o botón en Configuración) con:
  - los movimientos de la planilla CAMPO_ADELA (detalle abajo);
  - las 3 ventas de soja **sin monto** (ACA María Susana 63.590 kg, Gaviglio 30.760 kg, Landeta Cereales 24.600 kg).
- **Comprobantes:** subir foto o PDF desde la app → Apps Script lo guarda en una **carpeta compartida de Drive** (ID en Script Properties) → guarda la URL en `comprobanteUrl`.
  - Encapsular la subida en un módulo `storage.js` con una interfaz simple (`subir(archivo) → url`), para poder cambiar a Supabase en el futuro.
  - Offline: el archivo queda en cola en IndexedDB.
- Exportar a CSV desde el listado.

### Datos a migrar (campaña Soja 25-26)
Montos en ARS, pagó = Caja común.

| Concepto | Categoría | ARS |
|---|---|---:|
| Semilla (ago-25) | Insumos › Semilla | 1.589.014 |
| Siembra (nov-25) | Servicios › Siembra | 1.657.000 |
| Fumigación insumos (jun-25, nov-25, feb-26) | Insumos › Herbicidas | 1.700.715 |
| Fumigación mano de obra (5 pasadas) | Servicios › Pulverización | 910.000 |
| Servicio de cosecha (abr-26) | Servicios › Cosecha | 4.199.008 |
| Pago contrato (ago-25) | Impuestos › Contrato | 49.998 |
| Monotributo (feb-26) | Impuestos › Monotributo | 50.000 |
| Tubos de alcantarilla (nov-25) | Obras / mant. campo | 1.782.000 |

⚠️ La planilla tiene **14 filas** en la hoja Movimientos; esta tabla agrupa algunas. Antes de migrar, pedile al usuario el Excel `CAMPO_ADELA.xlsx` para importar fila por fila con su fecha y cotización originales. Los gastos sin campaña (impuestos, tubos) van con `campanaId` vacío.
