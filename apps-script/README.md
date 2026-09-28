# Backend en Google Apps Script

El backend es un único script (`Code.gs`) vinculado a un Google Sheet nuevo.
La app le habla por HTTP (`push` / `pull` / `init`) y el script lee y escribe las pestañas del Sheet.

## Instalación (una sola vez)

1. **Crear el Sheet.** En Google Drive: *Nuevo → Hojas de cálculo de Google*. Nombrarlo, por ejemplo, `Campo Adela - Datos`.
   Las pestañas las crea el script; no hace falta armarlas a mano.

2. **Pegar el código.** En el Sheet: *Extensiones → Apps Script*.
   - Renombrar el proyecto (arriba a la izquierda), por ejemplo `Campo API`.
   - Borrar el contenido de `Código.gs` y pegar **todo** el contenido de [`Code.gs`](Code.gs).
   - Guardar (💾 o Ctrl+S).

3. **Zona horaria.** *Configuración del proyecto* (⚙ a la izquierda) → *Zona horaria*: `(GMT-03:00) Buenos Aires`.

4. **Cargar la clave compartida.** En la misma pantalla de configuración, abajo:
   *Propiedades de la secuencia de comandos → Agregar propiedad*:
   - Propiedad: `CLAVE`
   - Valor: la clave que van a usar los tres (la misma que se carga en la app, en Configuración).
   - *Guardar propiedades de la secuencia de comandos*.

   Agregar también `CARPETA_COMPROBANTES` con el ID de la carpeta de Drive donde se guardan las fotos/PDF
   de comprobantes (la parte final de la URL de la carpeta: `drive.google.com/drive/folders/<ID>`).
   Los comprobantes heredan los permisos de esa carpeta: compartila con los tres hermanos.

5. **Inicializar y autorizar.** Volver al editor (`< >` a la izquierda). En la barra de arriba elegir la función
   `inicializar` y tocar **Ejecutar**. Google pide permisos:
   *Revisar permisos → elegir tu cuenta → Configuración avanzada → Ir a Campo API (no seguro) → Permitir*.
   (El aviso aparece porque es un script propio, no verificado por Google.)
   Al terminar, el Sheet tiene las pestañas `Hermanos`, `Categorias`, `Subcategorias`, `Campanas` y `Movimientos`,
   con los hermanos y las categorías iniciales.

6. **Desplegar como Web App.** *Implementar → Nueva implementación*:
   - ⚙ *Seleccionar tipo* → **Aplicación web**.
   - Descripción: `v1`.
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario** (la protección es la clave compartida).
   - *Implementar* y copiar la **URL de la aplicación web** (termina en `/exec`).

7. **Probar la URL.** Abrirla en el navegador: tiene que mostrar `{"ok":true,"datos":{"app":"campo"}}`.

8. **Configurar la app.** Pegar la URL en `js/config.js`:
   ```js
   export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
   ```
   Subir la versión (en `version.json` y `js/config.js`), commit y push.

## Actualizar el código del script

Pegar el `Code.gs` nuevo, guardar. Si la versión nueva usa un servicio de Google que antes no usaba
(por ejemplo Drive para los comprobantes), ejecutar una vez desde el editor la función que lo usa
(`autorizarDrive`) y aceptar el permiso nuevo. Luego *Implementar → Administrar implementaciones → ✏️ (editar) →
Versión: **Nueva versión** → Implementar*. Así **la URL no cambia**.
(Si se hace *Nueva implementación*, se genera otra URL y hay que cambiarla en la app.)

## Acciones del script

| Acción | Qué hace |
|---|---|
| `init` | Crea las pestañas y encabezados que falten y carga los datos iniciales. |
| `push` | Recibe registros (`{ entidad: [...] }`), hace upsert por `id` y gana el `modificado` más reciente. La app manda lotes de 100. |
| `pull` | Devuelve los registros con `syncTs > desde`. Con `limite` es **paginado**: `{ desde, limite, cursor }` → `{ registros, hayMas, cursor, totalPendiente, syncTs }`. Sin `limite` responde el formato anterior (`entidades`). |
| `log` | Agrega el log de errores de la app a la pestaña **Errores**, que se crea sola. Es solo append: si un error se repitió después de subirse, llega de nuevo con el mismo `uid` y el total de repeticiones. |
| `subirComprobante` | Guarda una foto o PDF en la carpeta de Drive `CARPETA_COMPROBANTES`. |

La versión 0.9.0 de la app necesita el `Code.gs` nuevo (acciones `log` y `pull` paginado): pegalo y publicá una **nueva versión** (ver "Actualizar el código del script"). Mientras no lo actualices, la sincronización sigue funcionando: la app entiende las dos respuestas de `pull` y, si `log` no existe, reintenta en el próximo sync.

## Pestaña "Errores"

Una fila por error registrado en cualquiera de los dispositivos. Columnas:
- `fecha`, `ultimaVez`, `usuario` (nombre del hermano), `nivel`, `codigo`;
- `mensajeUsuario` (lo que vio el usuario) y `mensajeTecnico`;
- `pantalla`, `accion`, `datos`;
- `version`, `online`, `userAgent`, `repeticiones`, `stack`, `uid` y `recibido` (cuándo llegó al Sheet).

Nunca incluye la clave ni el contenido de los requests. Se puede filtrar u ordenar libremente; la app solo agrega filas.

## Reglas del Sheet

- **Fila 1 = encabezados.** El script ubica las columnas por nombre: se pueden reordenar o agregar columnas propias.
  No renombrar los encabezados existentes.
- **Cada registro se ubica por `id`.** No editar los ids ni borrar filas: el borrado es lógico (`borrado = TRUE`).
- En `Movimientos`, las columnas `periodo`, `categoriaNombre`, `subcategoriaNombre`, `campanaNombre` y `pagoNombre`
  son solo para leer: el script las completa al escribir y las ignora al leer.
- `syncTs` lo maneja el script (momento de la última escritura). Si se edita una fila a mano, la app **no** se
  entera del cambio: las modificaciones se hacen siempre desde la app.
- Para cambiar la clave: cambiar la propiedad `CLAVE` y cargar la nueva en la app de cada uno.

## Probar sin desplegar

`node tools/apps-script-local.mjs` ejecuta este mismo `Code.gs` en Node con un Sheet simulado en memoria
(puerto 8090, clave `prueba`). La app abierta en `localhost` lo usa automáticamente en lugar del Sheet real.
`http://localhost:8090/__hojas` muestra el contenido de las pestañas.

## Zona horaria

Las fechas de calendario (`fecha`, `fechaInicio`, `tcFecha`, …) son texto `YYYY-MM-DD` y no se convierten.
Los timestamps (`creado`, `modificado`) son ISO en UTC (terminan en `Z`), igual en la app y en el script:
así se comparan para decidir qué edición gana. La zona `America/Argentina/Buenos_Aires` está fija en el código
de ambos lados.
