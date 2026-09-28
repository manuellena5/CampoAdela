// Datos iniciales con ids FIJOS: todos los dispositivos (y el Apps Script en la
// Fase 3) crean los mismos registros, así la sincronización no los duplica.

const sid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Fecha vieja: cualquier edición real gana en el last-write-wins.
const FECHA_SEED = '2026-01-01T00:00:00.000Z';

const base = () => ({
  creado: FECHA_SEED,
  modificado: FECHA_SEED,
  cargadoPor: 'sistema',
  borrado: false,
  pendiente: false,
});

const hermanos = [
  [1, 'Matias'],
  [2, 'Martin'],
  [3, 'Manuel'],
].map(([n, nombre]) => ({ id: sid(n), nombre, activo: true, ...base() }));

// [nro, nombre, tipo, subcategorías [nro, nombre]]
const ARBOL = [
  [101, 'Alquiler', 'gasto', []],
  [102, 'Insumos', 'gasto', [[201, 'Semilla'], [202, 'Herbicidas'], [203, 'Fertilizante'], [204, 'Otros']]],
  [103, 'Servicios', 'gasto', [[205, 'Siembra'], [206, 'Pulverización'], [207, 'Cosecha'], [208, 'Flete']]],
  [104, 'Seguro', 'gasto', []],
  [105, 'Honorarios ingeniero', 'gasto', []],
  [106, 'Impuestos', 'gasto', [[209, 'Monotributo'], [210, 'Contrato'], [211, 'Otros']]],
  [107, 'Obras / mant. campo', 'gasto', []],
  [108, 'Otros', 'gasto', []],
  [151, 'Venta de grano', 'ingreso', []],
  [152, 'Indemnización seguro', 'ingreso', []],
  [153, 'Otros', 'ingreso', []],
];

const categorias = [];
const subcategorias = [];
const ordenPorTipo = { gasto: 0, ingreso: 0 };

for (const [n, nombre, tipo, subs] of ARBOL) {
  const id = sid(n);
  categorias.push({ id, nombre, tipo, orden: ++ordenPorTipo[tipo], activa: true, ...base() });
  subs.forEach(([ns, nombreSub], i) => {
    subcategorias.push({ id: sid(ns), categoriaId: id, nombre: nombreSub, orden: i + 1, activa: true, ...base() });
  });
}

export const SEED = { hermanos, categorias, subcategorias };
