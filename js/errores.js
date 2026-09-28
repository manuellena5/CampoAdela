// Errores: clases propias, mensajes amigables (con código corto para informar) y log local.
//
//   registrarError(error, contexto, nivel?) → guarda en el log (tabla logErrores) y devuelve el mensaje amigable
//   notificarError(error, contexto, opciones?) → registra + muestra un toast con el mensaje amigable
//   mensajeAmigable(error) → { codigo, titulo, mensaje, accion? }
//
// Al usuario nunca se le muestra el stack, JSON crudo ni mensajes técnicos: solo el mensaje amigable.
// El detalle técnico queda en el log (Configuración → Registro de errores) y se sube al Sheet.

import { APP_VERSION } from './config.js';
import { db } from './db.js';
import { toast } from './lib/dom.js';

// ---------------------------------------------------------------- Clases

export class ErrorApp extends Error {
  constructor(mensaje, { causa, ...extra } = {}) {
    super(mensaje);
    this.name = this.constructor.name;
    if (causa) this.causa = causa;
    Object.assign(this, extra);
  }
}
export class ErrorRed extends ErrorApp {}
export class ErrorServidor extends ErrorApp {}
export class ErrorClave extends ErrorApp {}
export class ErrorValidacion extends ErrorApp {} // { campo }
export class ErrorCotizacion extends ErrorApp {}
export class ErrorBaseLocal extends ErrorApp {}

// ---------------------------------------------------------------- Clasificación

const MENSAJES = {
  'E-RED': {
    titulo: 'Sin conexión',
    mensaje: 'No hay conexión. Tus datos quedaron guardados en el teléfono y se van a subir cuando vuelva la señal.',
  },
  'E-CLAVE': {
    titulo: 'Clave incorrecta',
    mensaje: 'La clave compartida no es correcta. Revisala en Configuración.',
    accion: { tipo: 'configuracion', texto: 'Ir a Configuración' },
  },
  'E-SRV': {
    titulo: 'Error del servidor',
    mensaje: 'El servidor no respondió bien. Probá de nuevo en unos minutos.',
    accion: { tipo: 'reintentar', texto: 'Reintentar' },
  },
  'E-DOLAR': {
    titulo: 'Cotización no disponible',
    mensaje: 'No se pudo traer la cotización. Se usó la última disponible; podés editarla a mano.',
  },
  'E-DB': {
    titulo: 'Error al guardar',
    mensaje: 'Hubo un problema guardando en el teléfono.',
    accion: { tipo: 'reintentar', texto: 'Reintentar' },
  },
  'E-VAL': { titulo: 'Revisá los datos', mensaje: 'Hay datos incompletos o inválidos.' },
  'E-GEN': { titulo: 'Error inesperado', mensaje: 'Ocurrió un error inesperado. Quedó registrado en el log.' },
};

// Errores de IndexedDB / Dexie (por nombre).
const NOMBRES_DB = /^(QuotaExceededError|DatabaseClosedError|OpenFailedError|VersionError|ConstraintError|DataError|InvalidStateError|UnknownError|DataCloneError|ReadOnlyError|InvalidTableError|MissingAPIError|NoSuchDatabaseError|TransactionInactiveError|PrematureCommitError|SchemaError|UpgradeError|BulkError|ModifyError|DexieError)$/;

export function codigoDe(error) {
  if (error instanceof ErrorRed) return 'E-RED';
  if (error instanceof ErrorClave) return 'E-CLAVE';
  if (error instanceof ErrorServidor) return 'E-SRV';
  if (error instanceof ErrorCotizacion) return 'E-DOLAR';
  if (error instanceof ErrorBaseLocal) return 'E-DB';
  if (error instanceof ErrorValidacion) return 'E-VAL';
  const nombre = error?.name || '';
  const esRed = error instanceof TypeError && /fetch|network|load failed/i.test(error.message) && !/serviceworker/i.test(error.message);
  if (nombre === 'TimeoutError' || esRed) return 'E-RED';
  if (NOMBRES_DB.test(nombre) || globalThis.Dexie?.DexieError && error instanceof globalThis.Dexie.DexieError) return 'E-DB';
  return 'E-GEN';
}

export function mensajeAmigable(error) {
  const codigo = codigoDe(error);
  const base = MENSAJES[codigo];
  // Para E-VAL el mensaje específico del campo es parte de la validación (lo escribimos nosotros, en español).
  const mensaje = codigo === 'E-VAL' && error?.message ? error.message : base.mensaje;
  return { codigo, titulo: base.titulo, mensaje, ...(base.accion ? { accion: base.accion } : {}) };
}

// ---------------------------------------------------------------- Log

const MAX_ENTRADAS = 500;
const VENTANA_REPETICION_MS = 60 * 1000;
const CLAVE_BUFFER = 'campoLogErrores'; // fallback en localStorage si falla Dexie
const MAX_BUFFER = 50;
const oyentes = new Set();

// Suscripción a cambios del log (para el badge de Configuración).
export function alCambiarLog(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}
const avisarCambio = () => oyentes.forEach((fn) => { try { fn(); } catch { /* nada */ } });

const recortar = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

// Datos de contexto mínimos: nunca la clave ni payloads completos.
function sanitizar(datos) {
  if (!datos || typeof datos !== 'object') return datos === undefined ? undefined : recortar(String(datos), 200);
  const limpio = {};
  for (const [k, v] of Object.entries(datos)) {
    if (/clave|password|token|base64|payload|cuerpo|body/i.test(k)) continue;
    if (Array.isArray(v)) limpio[k] = `[${v.length} elementos]`;
    else if (v && typeof v === 'object') limpio[k] = '{…}';
    else if (typeof v === 'string') limpio[k] = recortar(v, 200);
    else limpio[k] = v;
  }
  return limpio;
}

// Mensaje técnico (con la causa original si la hay) y stack, para el log.
function detalleTecnico(error) {
  const partes = [];
  let e = error;
  for (let i = 0; e && i < 3; i++, e = e.causa) partes.push(`${e.name || 'Error'}: ${e.message ?? String(e)}`);
  const stack = error?.causa?.stack || error?.stack || '';
  return { mensajeTecnico: recortar(partes.join(' ← '), 1000), stack: recortar(stack, 3000) };
}

async function usuarioActual() {
  try { return (await db.ajustes.get('usuario'))?.valor || ''; } catch { return ''; }
}

function leerBuffer() {
  try { return JSON.parse(localStorage.getItem(CLAVE_BUFFER)) || []; } catch { return []; }
}

function guardarEnBuffer(entrada) {
  try {
    const buffer = leerBuffer();
    buffer.push(entrada);
    localStorage.setItem(CLAVE_BUFFER, JSON.stringify(buffer.slice(-MAX_BUFFER)));
  } catch { /* sin almacenamiento: no hay más que hacer */ }
}

// Mueve al log las entradas que quedaron en el buffer de localStorage (se llama al abrir la base).
export async function recuperarBuffer() {
  const buffer = leerBuffer();
  if (!buffer.length) return;
  try {
    await db.logErrores.bulkAdd(buffer.map(({ id, ...e }) => e));
    localStorage.removeItem(CLAVE_BUFFER);
  } catch { /* se reintenta la próxima vez */ }
}

/**
 * Guarda el error en el log y devuelve el mensaje amigable (+ id de la entrada).
 * contexto: { accion?, datos? } — la pantalla (hash) se agrega sola.
 */
export async function registrarError(error, contexto = {}, nivel = 'error') {
  const amigable = mensajeAmigable(error);
  const { mensajeTecnico, stack } = detalleTecnico(error);
  const ahora = new Date().toISOString();
  const entrada = {
    uid: crypto.randomUUID(),
    fecha: ahora,
    ultimaVez: ahora,
    nivel,
    codigo: amigable.codigo,
    mensajeUsuario: amigable.mensaje,
    mensajeTecnico,
    stack,
    contexto: { pantalla: location.hash || '#/', accion: contexto.accion || '', datos: sanitizar(contexto.datos) },
    version: APP_VERSION,
    usuario: await usuarioActual(),
    online: navigator.onLine,
    userAgent: recortar(navigator.userAgent, 200),
    repeticiones: 1,
    enviado: false,
  };
  console.warn(`[${amigable.codigo}]`, error);

  try {
    const id = await db.transaction('rw', db.logErrores, async () => {
      // Mismo código y mensaje en menos de 1 minuto: se suma una repetición.
      const desde = new Date(Date.now() - VENTANA_REPETICION_MS).toISOString();
      const previa = await db.logErrores.where('fecha').above(desde).reverse()
        .filter((e) => e.codigo === entrada.codigo && e.mensajeTecnico === entrada.mensajeTecnico).first();
      if (previa) {
        // Si ya se había subido, vuelve a subirse con el total (la pestaña Errores es solo append).
        await db.logErrores.update(previa.id, { repeticiones: (previa.repeticiones || 1) + 1, ultimaVez: ahora, enviado: false });
        return previa.id;
      }
      const nuevo = await db.logErrores.add(entrada);
      const total = await db.logErrores.count();
      if (total > MAX_ENTRADAS) {
        const viejas = await db.logErrores.orderBy('id').limit(total - MAX_ENTRADAS).primaryKeys();
        await db.logErrores.bulkDelete(viejas);
      }
      return nuevo;
    });
    avisarCambio();
    return { ...amigable, id };
  } catch (err) {
    console.warn('No se pudo guardar el error en la base; queda en localStorage', err);
    guardarEnBuffer(entrada);
    return { ...amigable, id: null };
  }
}

// ---------------------------------------------------------------- Notificación

let accionesPorTipo = {};
/** Registra qué hacer con las acciones de los mensajes ('configuracion', 'reintentar' por defecto). */
export function configurarAcciones(acciones) {
  accionesPorTipo = acciones;
}

/**
 * Registra el error y lo muestra en un toast.
 * opciones: { nivel?, reintentar?: función, silencioso?: sin toast }
 */
export async function notificarError(error, contexto = {}, opciones = {}) {
  const nivel = opciones.nivel || (codigoDe(error) === 'E-RED' ? 'advertencia' : 'error');
  const amigable = await registrarError(error, contexto, nivel);
  if (opciones.silencioso || amigable.codigo === 'E-VAL') return amigable; // E-VAL se muestra junto al campo
  const acciones = [];
  if (amigable.accion) {
    const fn = amigable.accion.tipo === 'reintentar'
      ? opciones.reintentar || accionesPorTipo.reintentar?.(amigable.codigo)
      : accionesPorTipo[amigable.accion.tipo];
    if (fn) acciones.push({ texto: amigable.accion.texto, fn });
  }
  toast(amigable.mensaje, {
    tipo: nivel === 'advertencia' ? 'advertencia' : 'error',
    codigo: amigable.codigo,
    detalleId: amigable.id,
    acciones,
  });
  return amigable;
}

// Convierte cualquier error de IndexedDB en ErrorBaseLocal (conservando la causa).
export function comoErrorBaseLocal(err, accion) {
  if (err instanceof ErrorApp) return err;
  return new ErrorBaseLocal(`Falló ${accion} en la base local`, { causa: err });
}
