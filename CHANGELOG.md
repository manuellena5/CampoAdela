# Changelog

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
