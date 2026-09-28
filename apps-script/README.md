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

Pegar el `Code.gs` nuevo, guardar, y luego *Implementar → Administrar implementaciones → ✏️ (editar) →
Versión: **Nueva versión** → Implementar*. Así **la URL no cambia**.
(Si se hace *Nueva implementación*, se genera otra URL y hay que cambiarla en la app.)

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
