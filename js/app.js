// js/app.js
import { db, collection, addDoc, getDocs, getDoc, setDoc, query, orderBy, serverTimestamp, where, updateDoc, doc, runTransaction } from "./firebase.js";
import { cargarProfesores, cargarLaboratorios, cargarHerramientas, cargarCiclos, agregarCicloNuevo } from "./inventario.js";

// ---- Sanitización de texto (anti-XSS) ----
// El panel admin muestra estos datos con innerHTML en varias tablas/tarjetas.
// Si alguien escribe algo como "<img src=x onerror=...>" en el formulario,
// esto evita que ese código se ejecute cuando el admin lo vea.
function sanitizar(texto) {
  if (typeof texto !== "string") return texto;
  const mapa = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
  return texto.replace(/[&<>"']/g, (c) => mapa[c]);
}

// ---- Pantallas ----
const pantallasBienvenida  = document.getElementById("pantalla-bienvenida");
const pantallaTaller       = document.getElementById("pantalla-taller");
const pantallaFormulario   = document.getElementById("pantalla-formulario");
const pantallaEpp          = document.getElementById("pantalla-epp");
const pantallaFinal        = document.getElementById("pantalla-final");

function mostrarPantalla(el) {
  [pantallasBienvenida, pantallaTaller, pantallaFormulario, pantallaEpp, pantallaFinal]
    .forEach(p => p.classList.add("oculto"));
  el.classList.remove("oculto");
  window.scrollTo(0, 0);
}

document.getElementById("btn-ir-taller").addEventListener("click", () => {
  mostrarPantalla(pantallaTaller);
});

document.getElementById("btn-ir-formulario").addEventListener("click", () => {
  mostrarPantalla(pantallaFormulario);
});

// ---- Formulario ----
const MAX_POR_ESTUDIANTE = 1; // tope de unidades por herramienta, por solicitud (por defecto)

// Algunas herramientas (materiales gastables como electrodos, cinta, etc.)
// necesitan permitir más de 1 unidad por estudiante. Eso se configura por
// herramienta desde el panel admin ("Límite por estudiante"); si no se
// configuró nada, se usa el tope general de 1.
function limiteEstudiantePara(h) {
  return (h && Number.isFinite(h.limitePorEstudiante) && h.limitePorEstudiante > 0)
    ? h.limitePorEstudiante
    : MAX_POR_ESTUDIANTE;
}
const form              = document.getElementById("form-solicitud");
const selectProfesor    = document.getElementById("profesor");
const selectLaboratorio = document.getElementById("laboratorio");
const selectCiclo       = document.getElementById("ciclo");
const selectTipo        = document.getElementById("tipo-solicitud");
const gridHerramientas  = document.getElementById("grid-herramientas");
const btnEnviar         = document.getElementById("btn-enviar");
const btnContinuar      = document.getElementById("btn-continuar");
const btnNuevaSolicitud = document.getElementById("btn-nueva-solicitud");
const textoNumeroSol    = document.getElementById("texto-numero-solicitud");
const textoDespedida    = document.getElementById("texto-despedida");
const btnOlvidarDatos   = document.getElementById("btn-olvidar-datos");

// ---- Elementos de "Agregar herramientas adicionales" ----
const formularioCompleto = document.getElementById("formulario-completo");
const seccionAdicional   = document.getElementById("seccion-adicional");
const inputMatriculaAdicional = document.getElementById("matricula-adicional");
const btnBuscarAdicional      = document.getElementById("btn-buscar-adicional");

// ---- Autoformato de matrícula: el estudiante solo escribe números y los
// guiones se insertan solos, con el formato N-NN-NNNN (ej. 1-19-0117) ----
function formatearMatricula(valor) {
  const digitos = valor.replace(/\D/g, "").slice(0, 7);
  let resultado = digitos;
  if (digitos.length > 1) resultado = digitos.slice(0, 1) + "-" + digitos.slice(1);
  if (digitos.length > 3) resultado = digitos.slice(0, 1) + "-" + digitos.slice(1, 3) + "-" + digitos.slice(3);
  return resultado;
}
function activarAutoformatoMatricula(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    const cursorAlFinal = input.selectionStart === input.value.length;
    input.value = formatearMatricula(input.value);
    if (cursorAlFinal) input.selectionStart = input.selectionEnd = input.value.length;
  });
}
activarAutoformatoMatricula(document.getElementById("matricula"));
activarAutoformatoMatricula(inputMatriculaAdicional);

// ---- Cámara ----
const btnCamara       = document.getElementById("btn-camara");
const inputCamara     = document.getElementById("input-camara");
const fotoPreviewWrap = document.getElementById("foto-preview-wrap");
const fotoPreview     = document.getElementById("foto-preview");
const btnQuitarFoto   = document.getElementById("btn-quitar-foto");

// Antes de abrir la cámara se guarda lo que el estudiante ya llenó
// (nombre, matrícula, etc.) como red de seguridad: en celulares con poca
// RAM (ej. gama baja con MIUI) el sistema puede cerrar la pestaña del
// navegador mientras la app de cámara está abierta. Así, si eso pasa y el
// estudiante tiene que volver a abrir el formulario, no pierde lo ya escrito.
btnCamara.addEventListener("click", () => {
  guardarDatosPersonales();
  inputCamara.click();
});

// La foto del carnet se guarda como texto (base64) directo en el documento
// de Firestore -- no usa Firebase Storage porque tiene costo por uso. Para
// que quepa sin problema (Firestore limita cada documento a 1MB), se
// redimensiona y comprime antes de guardarla: un carnet no necesita
// resolución alta para verse legible.
//
// IMPORTANTE (memoria): las fotos de cámara vienen en resolución completa
// (varias decenas de MB una vez descomprimidas), y decodificar esa imagen
// dos veces a la vez -- una para el preview, otra para comprimir -- podía
// agotar la memoria en celulares con poco RAM ("memoria insuficiente").
// Por eso ahora se decodifica UNA sola vez: se usa createImageBitmap con
// resize integrado cuando el navegador lo soporta (le pide al navegador
// que decodifique directo a tamaño chico, sin pasar por la resolución
// completa), y el resultado comprimido se reutiliza también como preview.
let fotoCarnetBase64 = null;

async function comprimirImagenACarnet(file, maxAncho = 360, calidad = 0.55) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { resizeWidth: maxAncho, resizeQuality: "medium" });
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close(); // libera la memoria del bitmap de inmediato
      const resultado = canvas.toDataURL("image/jpeg", calidad);
      canvas.width = 0; canvas.height = 0; // ayuda al navegador a liberar el canvas antes
      return resultado;
    } catch (err) {
      console.warn("createImageBitmap con resize falló, se usa el método de respaldo:", err);
    }
  }

  // Respaldo para navegadores sin soporte de resize en createImageBitmap
  // (ej. Safari viejo). Decodifica a resolución completa, así que en
  // fotos gigantes puede seguir siendo pesado, pero cubre esos casos.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxAncho / img.width);
      const w = Math.max(1, Math.round(img.width * escala));
      const h = Math.max(1, Math.round(img.height * escala));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const resultado = canvas.toDataURL("image/jpeg", calidad);
      canvas.width = 0; canvas.height = 0;
      img.src = ""; // suelta la imagen decodificada de memoria
      resolve(resultado);
    };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}

// Envoltorio con reintentos: en celulares con poca memoria (ej. gama baja
// con cámara de 50MP+ y 4GB de RAM), un archivo de foto sin comprimir
// puede pesar ~190MB ya descomprimido en crudo -- eso puede tumbar la
// pestaña del navegador de un tirón (el sistema operativo mata el proceso
// por falta de memoria), sin dar tiempo siquiera a que salte un error de
// JavaScript que se pueda atrapar con try/catch. Por eso NO se arranca
// siempre en 360px esperando a que falle: el tamaño de arranque se elige
// según qué tan pesado es el archivo, para que el primer intento en fotos
// de cámaras muy grandes ya sea chico de entrada.
async function comprimirImagenACarnetConReintentos(file) {
  const pesoMB = file.size / 1024 / 1024;
  if (pesoMB > 15) {
    console.warn(`Foto de carnet muy pesada (${pesoMB.toFixed(1)}MB) -- puede tardar o fallar en equipos con poca memoria.`);
  }

  // Arranca más chico mientras más pesado es el archivo original.
  let intentos;
  if (pesoMB > 8) intentos = [200, 140];
  else if (pesoMB > 4) intentos = [280, 200, 140];
  else intentos = [360, 240, 160];

  let ultimoError = null;
  for (const maxAncho of intentos) {
    try {
      return await comprimirImagenACarnet(file, maxAncho, 0.55);
    } catch (err) {
      ultimoError = err;
      console.warn(`Falló comprimir a ${maxAncho}px, reintentando más chico si queda otro intento...`, err);
    }
  }
  throw ultimoError;
}

// Procesa un archivo de imagen (venga de la cámara o de la galería) con el
// mismo pipeline de compresión con reintentos. Compartido entre los dos
// inputs para no duplicar la lógica de error/preview.
async function procesarFotoSeleccionada(file, inputQueLaDisparo) {
  if (!file) return;

  fotoPreviewWrap.classList.remove("oculto");
  fotoPreview.src = ""; // limpio mientras procesa -- ya no se muestra la foto sin comprimir

  try {
    fotoCarnetBase64 = await comprimirImagenACarnetConReintentos(file);
    fotoPreview.src = fotoCarnetBase64; // el preview usa la versión ya comprimida
    guardarDatosPersonales();
  } catch (err) {
    console.error("Error al procesar la foto del carnet:", err);
    fotoCarnetBase64 = null;
    fotoPreviewWrap.classList.add("oculto");
    // Si fue la cámara la que falló, se recuerda la alternativa de galería
    // (una foto de galería puede venir ya comprimida por otra app, o el
    // usuario puede tomarla con la cámara nativa a menor resolución primero).
    if (inputQueLaDisparo === inputCamara) {
      mostrarError("No se pudo procesar la foto incluso reduciendo el tamaño varias veces -- puede ser memoria insuficiente en el equipo. Prueba con 'Subir desde galería' usando una foto que ya tengas o que tomes con la cámara nativa del teléfono.");
    } else {
      mostrarError("No se pudo procesar esa foto incluso reduciendo el tamaño varias veces. Intenta con otra foto, idealmente más liviana.");
    }
  } finally {
    // La foto original (varios MB) ya no hace falta -- se limpia del <input>
    // apenas se tiene la versión comprimida, para no retenerla en memoria
    // el resto del formulario hasta que se envíe la solicitud.
    inputQueLaDisparo.value = "";
  }
}

inputCamara.addEventListener("change", () => {
  procesarFotoSeleccionada(inputCamara.files[0], inputCamara);
});

// Input alterno sin el atributo "capture": en vez de forzar la cámara,
// abre el selector de archivos/galería normal del teléfono. Visible desde
// el inicio como opción, no solo cuando falla la cámara -- así el usuario
// elige de entrada la vía que le resulte más liviana.
const inputGaleria = document.getElementById("input-galeria");
inputGaleria?.addEventListener("change", () => {
  procesarFotoSeleccionada(inputGaleria.files[0], inputGaleria);
});
document.getElementById("btn-galeria")?.addEventListener("click", () => {
  inputGaleria?.click();
});

btnQuitarFoto.addEventListener("click", () => {
  fotoPreview.src = "";
  inputCamara.value = "";
  fotoPreviewWrap.classList.add("oculto");
  fotoCarnetBase64 = null;
  guardarDatosPersonales();
});

// ---- Recordar datos personales en este dispositivo (localStorage) ----
// Ahora se guarda POR MATRÍCULA (no solo "el último que usó el dispositivo"):
// así, si varios estudiantes comparten un mismo celular/tablet del taller,
// cada uno recupera SUS propios datos y foto al escribir SU matrícula,
// sin pisar los datos de los demás.
const CLAVE_DATOS_PREFIJO   = "controlHerramientas_datosPersonales_";
const CLAVE_ULTIMA_MATRICULA = "controlHerramientas_ultimaMatricula";
const CAMPOS_TEXTO_GUARDADOS = ["nombre", "apellido", "matricula", "telefono"];
const REGEX_MATRICULA = /^\d-\d{2}-\d{4}$/;

// ---- Token de propiedad de la solicitud (anti-secuestro) ----
// activaHoy/{matricula} es público (para que el formulario sepa si ya hay
// una solicitud hoy) y ya no expone el ID real de la solicitud. Para poder
// agregar herramientas después, este dispositivo guarda localmente el ID
// real + un token secreto generado al crear la solicitud. Sin ese token
// exacto, Firestore rechaza cualquier intento de modificar la solicitud
// de otra persona aunque alguien adivine o vea su matrícula.
const CLAVE_TOKEN_PREFIJO = "controlHerramientas_token_";

function generarToken() {
  if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function guardarTokenLocal(matricula, id, token) {
  try {
    localStorage.setItem(CLAVE_TOKEN_PREFIJO + matricula, JSON.stringify({ id, token, fecha: new Date().toDateString() }));
  } catch {}
}

function obtenerTokenLocal(matricula) {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_TOKEN_PREFIJO + matricula) || "null");
    if (!datos || datos.fecha !== new Date().toDateString()) return null; // solo vale para hoy
    return datos;
  } catch {
    return null;
  }
}

function obtenerDatosPorMatricula(matricula) {
  if (!matricula) return null;
  try {
    return JSON.parse(localStorage.getItem(CLAVE_DATOS_PREFIJO + matricula) || "null");
  } catch {
    return null;
  }
}

// Se usa al abrir el formulario: recupera los datos de la última matrícula
// usada en este dispositivo (para no dejar el formulario vacío de entrada).
function obtenerDatosGuardados() {
  try {
    const ultima = localStorage.getItem(CLAVE_ULTIMA_MATRICULA) || "";
    return obtenerDatosPorMatricula(ultima);
  } catch {
    return null;
  }
}

function guardarDatosPersonales() {
  const matricula = document.getElementById("matricula")?.value.trim() || "";
  // Solo se guarda (y sirve de "llave") cuando la matrícula ya está completa;
  // mientras se escribe a medias no hay bajo qué matrícula archivar los datos.
  if (!REGEX_MATRICULA.test(matricula)) return;

  const datos = {};
  CAMPOS_TEXTO_GUARDADOS.forEach(id => {
    const el = document.getElementById(id);
    if (el) datos[id] = el.value;
  });
  datos.profesor    = selectProfesor.value;
  datos.laboratorio = selectLaboratorio.value;
  datos.ciclo       = selectCiclo.value;
  datos.fotoCarnet  = fotoCarnetBase64 || null;
  try {
    localStorage.setItem(CLAVE_DATOS_PREFIJO + matricula, JSON.stringify(datos));
    localStorage.setItem(CLAVE_ULTIMA_MATRICULA, matricula);
  } catch {}
}

// Precarga los campos de texto (los <select> se precargan aparte,
// una vez que sus opciones ya fueron cargadas desde Firestore).
function precargarCamposTexto() {
  const datos = obtenerDatosGuardados();
  if (!datos) return;
  CAMPOS_TEXTO_GUARDADOS.forEach(id => {
    const el = document.getElementById(id);
    if (el && datos[id]) el.value = datos[id];
  });
  if (datos.fotoCarnet) {
    fotoCarnetBase64 = datos.fotoCarnet;
    fotoPreview.src = fotoCarnetBase64;
    fotoPreviewWrap.classList.remove("oculto");
  } else {
    fotoCarnetBase64 = null;
    fotoPreview.src = "";
    fotoPreviewWrap.classList.add("oculto");
  }
}

function precargarSelects() {
  const datos = obtenerDatosGuardados();
  if (!datos) return;
  if (datos.profesor && [...selectProfesor.options].some(o => o.value === datos.profesor)) {
    selectProfesor.value = datos.profesor;
  }
  if (datos.laboratorio && [...selectLaboratorio.options].some(o => o.value === datos.laboratorio)) {
    selectLaboratorio.value = datos.laboratorio;
  }
}

// Cuando la matrícula queda completa (ya sea tecleada o pegada), se busca
// si ESA matrícula ya tiene datos guardados en este dispositivo y, si los
// tiene, se cargan sus campos y foto -- así varios estudiantes pueden
// compartir un mismo dispositivo y cada uno recupera lo suyo.
document.getElementById("matricula")?.addEventListener("input", () => {
  const matricula = document.getElementById("matricula").value.trim();
  if (!REGEX_MATRICULA.test(matricula)) return;
  const datos = obtenerDatosPorMatricula(matricula);
  if (!datos) return; // matrícula nueva en este dispositivo: no hay nada que precargar

  document.getElementById("nombre").value    = datos.nombre    || "";
  document.getElementById("apellido").value  = datos.apellido  || "";
  document.getElementById("telefono").value  = datos.telefono  || "";
  if (datos.profesor && [...selectProfesor.options].some(o => o.value === datos.profesor)) {
    selectProfesor.value = datos.profesor;
  }
  if (datos.laboratorio && [...selectLaboratorio.options].some(o => o.value === datos.laboratorio)) {
    selectLaboratorio.value = datos.laboratorio;
  }
  if (datos.ciclo && [...selectCiclo.options].some(o => o.value === datos.ciclo)) {
    selectCiclo.value = datos.ciclo;
  }
  if (datos.fotoCarnet) {
    fotoCarnetBase64 = datos.fotoCarnet;
    fotoPreview.src = fotoCarnetBase64;
    fotoPreviewWrap.classList.remove("oculto");
  } else {
    fotoCarnetBase64 = null;
    fotoPreview.src = "";
    fotoPreviewWrap.classList.add("oculto");
  }
  try { localStorage.setItem(CLAVE_ULTIMA_MATRICULA, matricula); } catch {}
});

// Guardar en vivo mientras el estudiante escribe/selecciona.
CAMPOS_TEXTO_GUARDADOS.forEach(id => {
  document.getElementById(id)?.addEventListener("input", guardarDatosPersonales);
});
selectProfesor.addEventListener("change", guardarDatosPersonales);
selectLaboratorio.addEventListener("change", guardarDatosPersonales);
selectCiclo.addEventListener("change", guardarDatosPersonales);

btnOlvidarDatos?.addEventListener("click", () => {
  const matricula = document.getElementById("matricula")?.value.trim();
  try {
    if (matricula) localStorage.removeItem(CLAVE_DATOS_PREFIJO + matricula);
    localStorage.removeItem(CLAVE_ULTIMA_MATRICULA);
  } catch {}
  document.getElementById("nombre").value = "";
  document.getElementById("apellido").value = "";
  document.getElementById("matricula").value = "";
  document.getElementById("telefono").value = "";
  fotoCarnetBase64 = null;
  fotoPreview.src = "";
  fotoPreviewWrap.classList.add("oculto");
  mostrarError("Se olvidaron tus datos guardados en este dispositivo.");
});

// ---- Mostrar/ocultar secciones según tipo ----
function toggleSecciones() {
  const esAdicional = selectTipo.value === "adicional";
  formularioCompleto.style.display = esAdicional ? "none" : "block";
  seccionAdicional.style.display = esAdicional ? "block" : "none";
  document.querySelectorAll("#formulario-completo input, #formulario-completo select")
    .forEach(el => el.required = !esAdicional);
}

selectTipo.addEventListener("change", toggleSecciones);
setTimeout(toggleSecciones, 50);

// ---- Buscar solicitud activa para agregar herramientas ----
btnBuscarAdicional.addEventListener("click", async () => {
  const matricula = inputMatriculaAdicional.value.trim();
  if (!matricula) {
    mostrarError("Ingresa tu matrícula.");
    return;
  }
  if (!/^\d-\d{2}-\d{4}$/.test(matricula)) {
    mostrarError("La matrícula debe tener el formato 0-00-0000 (ej. 1-19-0117).");
    return;
  }

  btnBuscarAdicional.disabled = true;
  btnBuscarAdicional.textContent = "Buscando...";

  try {
    const solicitud = await buscarSolicitudActivaHoy(matricula);
    if (!solicitud) {
      mostrarError("No tienes una solicitud activa hoy. Selecciona 'Solicitando herramientas' para crear una nueva.");
      btnBuscarAdicional.disabled = false;
      btnBuscarAdicional.textContent = "Buscar solicitud activa";
      return;
    }
    if (solicitud.estado === "retornada" || solicitud.estado === "cancelada") {
      mostrarError(`Esta solicitud ya está ${solicitud.estado}. No se pueden agregar más herramientas.`);
      btnBuscarAdicional.disabled = false;
      btnBuscarAdicional.textContent = "Buscar solicitud activa";
      return;
    }
    if (solicitud.soloLectura || !solicitud.id) {
      mostrarError("Tienes una solicitud activa hoy, pero no fue creada en este dispositivo/navegador. Por seguridad, solo puedes agregar herramientas desde donde la creaste, o pide ayuda al encargado del taller.");
      btnBuscarAdicional.disabled = false;
      btnBuscarAdicional.textContent = "Buscar solicitud activa";
      return;
    }
    abrirModalDuplicado(solicitud, herramientasDisponibles);
  } catch (err) {
    console.error("Error al buscar solicitud:", err);
    mostrarError("Error al buscar la solicitud. Intenta de nuevo.");
  }

  btnBuscarAdicional.disabled = false;
  btnBuscarAdicional.textContent = "Buscar solicitud activa";
});

// ---- Estado herramientas ----
let herramientasDisponibles = [];
let cantidadesSeleccionadas = {};
let datosSolicitudPendiente = null;

// ---- Modal de confirmación moderno (reemplaza al confirm() nativo) ----
// Autocontenido (crea su propio DOM) para no depender de markup fijo en el
// HTML, con el mismo estilo visual que el resto de modales del formulario.
function confirmarPersonalizado(mensaje, opciones = {}) {
  const { titulo = "¿Deseas continuar?", textoSi = "Aceptar", textoNo = "Cancelar", icono = "❓" } = opciones;
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.id = "modal-confirm-custom";
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.6);
      display:flex;align-items:center;justify-content:center;
      z-index:10000;padding:16px;
    `;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:400px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.18);overflow:hidden">
        <div style="background:var(--verde-oscuro);padding:18px 20px 14px;text-align:center">
          <div style="font-size:26px;margin-bottom:6px">${icono}</div>
          <h2 style="margin:0;color:#fff;font-size:16px;font-weight:800;line-height:1.3">${titulo}</h2>
        </div>
        <div style="padding:18px 20px">
          <p id="confirm-custom-msg" style="margin:0 0 18px;font-size:14px;color:var(--texto);line-height:1.6;white-space:pre-line">${mensaje}</p>
          <div style="display:flex;gap:10px">
            <button id="confirm-custom-no" style="flex:1;padding:13px;border-radius:8px;border:1.5px solid #c8c8c8;background:#fff;color:var(--gris);font-size:14px;font-weight:600;cursor:pointer">${textoNo}</button>
            <button id="confirm-custom-si" class="btn-enviar" style="flex:1;margin:0">${textoSi}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const btnSi = document.getElementById("confirm-custom-si");
    const btnNo = document.getElementById("confirm-custom-no");
    const limpiar = (resultado) => {
      modal.remove();
      resolve(resultado);
    };
    btnSi.onclick = () => limpiar(true);
    btnNo.onclick = () => limpiar(false);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) limpiar(false); // clic fuera de la tarjeta = cancelar
    });
  });
}

// ---- Modal duplicado ----
let solicitudExistenteId   = null;
let solicitudExistente     = null;
let cantidadesModalExtra   = {};

function mostrarError(msg) {
  const toast = document.createElement("div");
  toast.className = "toast-error";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function llenarSelect(select, items, campo) {
  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item[campo] || item.nombre;
    opt.textContent = item[campo] || item.nombre;
    select.appendChild(opt);
  });
}

// Clave estable para identificar una herramienta, con o sin campo "codigo".
// Las herramientas subidas desde el panel solo tienen id de Firestore.
function claveHerramienta(h) {
  return h.codigo || h.id;
}

function crearTarjetaHerramienta(h) {
  const key = claveHerramienta(h);
  cantidadesSeleccionadas[key] = 0;
  const maxDisponible = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;

  const card = document.createElement("div");
  card.className = "tarjeta-herramienta";
  card.innerHTML = `
    <div class="icono">
      <img src="${h.imagen}" alt="${h.nombre}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="icono-respaldo" style="display:none">${h.icono || "🔧"}</div>
    </div>
    <div class="nombre">${h.nombre}</div>
    <div class="disponible">Disp. ${maxDisponible}</div>
    <div class="contador">
      <button type="button" data-codigo="${key}" data-accion="restar">−</button>
      <span class="cantidad" id="cant-${key}">0</span>
      <button type="button" data-codigo="${key}" data-accion="sumar" ${maxDisponible === 0 ? "disabled" : ""}>+</button>
    </div>
  `;
  return card;
}

function renderizarHerramientas(herramientas) {
  gridHerramientas.innerHTML = "";

  // Agrupar por "practica" (campo opcional asignado desde el panel admin).
  // Las que no tienen práctica asignada van sueltas, sin encabezado.
  const grupos = new Map();
  const sinGrupo = [];
  herramientas.forEach(h => {
    if (h.practica) {
      if (!grupos.has(h.practica)) grupos.set(h.practica, []);
      grupos.get(h.practica).push(h);
    } else {
      sinGrupo.push(h);
    }
  });

  [...grupos.keys()].sort((a, b) => a.localeCompare(b)).forEach(practica => {
    const header = document.createElement("div");
    header.className = "grupo-practica-header";
    header.style.gridColumn = "1 / -1";
    header.innerHTML = `
      <span class="grupo-practica-titulo">🏷️ ${practica}</span>
      <button type="button" class="btn-combo" id="btn-combo-${CSS.escape(practica)}" data-practica="${practica}">+ Combo completo</button>
    `;
    gridHerramientas.appendChild(header);

    const cont = document.createElement("div");
    cont.className = "grid-herramientas";
    cont.style.gridColumn = "1 / -1";
    grupos.get(practica).forEach(h => cont.appendChild(crearTarjetaHerramienta(h)));
    gridHerramientas.appendChild(cont);
  });

  if (sinGrupo.length) {
    if (grupos.size) {
      const header = document.createElement("div");
      header.className = "grupo-practica-header";
      header.style.gridColumn = "1 / -1";
      header.innerHTML = `<span class="grupo-practica-titulo">🔧 Otras herramientas</span>`;
      gridHerramientas.appendChild(header);
    }
    const cont = document.createElement("div");
    cont.className = "grid-herramientas";
    cont.style.gridColumn = "1 / -1";
    sinGrupo.forEach(h => cont.appendChild(crearTarjetaHerramienta(h)));
    gridHerramientas.appendChild(cont);
  }
}

// Marca 1 unidad de cada herramienta del grupo indicado (si hay disponibilidad).
function comboEstaCompleto(practica) {
  const tools = herramientasDisponibles.filter(h => h.practica === practica);
  if (!tools.length) return false;
  return tools.every(h => (cantidadesSeleccionadas[claveHerramienta(h)] || 0) > 0);
}

function actualizarBotonCombo(practica) {
  const btn = document.getElementById(`btn-combo-${CSS.escape(practica)}`);
  if (!btn) return;
  if (comboEstaCompleto(practica)) {
    btn.textContent = "✕ Quitar combo";
    btn.classList.add("combo-activo");
  } else {
    btn.textContent = "+ Combo completo";
    btn.classList.remove("combo-activo");
  }
}

function quitarComboCompleto(practica) {
  const tools = herramientasDisponibles.filter(h => h.practica === practica);
  tools.forEach(h => {
    const key = claveHerramienta(h);
    cantidadesSeleccionadas[key] = 0;
    const span = document.getElementById(`cant-${key}`);
    if (span) span.textContent = "0";
    const card = gridHerramientas.querySelector(`button[data-codigo="${key}"]`)?.closest(".tarjeta-herramienta");
    if (card) card.classList.remove("seleccionada");
    const btnSumar = gridHerramientas.querySelector(`button[data-codigo="${key}"][data-accion="sumar"]`);
    if (btnSumar) btnSumar.disabled = false;
  });
}

function agregarComboCompleto(practica) {
  const tools = herramientasDisponibles.filter(h => h.practica === practica);
  const sinDisponibilidad = [];

  tools.forEach(h => {
    const key = claveHerramienta(h);
    const max = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;
    const limite = Math.min(max, limiteEstudiantePara(h));
    if (max === 0) { sinDisponibilidad.push(h.nombre); return; }
    if ((cantidadesSeleccionadas[key] || 0) >= limite) return; // ya está al tope

    cantidadesSeleccionadas[key] = 1;
    const span = document.getElementById(`cant-${key}`);
    if (span) span.textContent = "1";
    const card = gridHerramientas.querySelector(`button[data-codigo="${key}"]`)?.closest(".tarjeta-herramienta");
    if (card) card.classList.add("seleccionada");
    const btnSumar = gridHerramientas.querySelector(`button[data-codigo="${key}"][data-accion="sumar"]`);
    if (btnSumar) btnSumar.disabled = 1 >= limite;
  });

  if (sinDisponibilidad.length) {
    mostrarError(`Sin disponibilidad ahora mismo: ${sinDisponibilidad.join(", ")}.`);
  }
}

gridHerramientas.addEventListener("click", (e) => {
  const comboBtn = e.target.closest("button.btn-combo");
  if (comboBtn) {
    const practica = comboBtn.dataset.practica;
    if (comboEstaCompleto(practica)) {
      quitarComboCompleto(practica);
    } else {
      agregarComboCompleto(practica);
    }
    actualizarBotonCombo(practica);
    return;
  }

  const btn = e.target.closest("button[data-codigo]");
  if (!btn) return;

  const codigo = btn.dataset.codigo;
  const accion = btn.dataset.accion;
  const info = herramientasDisponibles.find(h => claveHerramienta(h) === codigo);
  const maxDisponible = info && Number.isFinite(info.cantidadDisponible) ? info.cantidadDisponible : 5;
  const limiteEstudiante = limiteEstudiantePara(info);
  const limite = Math.min(maxDisponible, limiteEstudiante);

  let cantidad = cantidadesSeleccionadas[codigo] || 0;

  if (accion === "sumar") {
    if (cantidad >= limite) {
      const msg = maxDisponible < limiteEstudiante
        ? `Solo hay ${maxDisponible} disponible(s) de "${info ? info.nombre : codigo}".`
        : `Máximo ${limiteEstudiante} unidad(es) de "${info ? info.nombre : codigo}" por estudiante.`;
      mostrarError(msg);
      return;
    }
    cantidad += 1;
  }
  if (accion === "restar" && cantidad > 0) cantidad -= 1;

  cantidadesSeleccionadas[codigo] = cantidad;
  document.getElementById(`cant-${codigo}`).textContent = cantidad;

  // Marcar/desmarcar tarjeta visualmente
  const card = gridHerramientas.querySelector(`button[data-codigo="${codigo}"]`)?.closest(".tarjeta-herramienta");
  if (card) card.classList.toggle("seleccionada", cantidad > 0);

  if (info && info.practica) actualizarBotonCombo(info.practica);

  const btnSumar = gridHerramientas.querySelector(`button[data-codigo="${codigo}"][data-accion="sumar"]`);
  if (btnSumar) btnSumar.disabled = cantidad >= limite;
});

async function inicializar() {
  precargarCamposTexto();

  const [profesores, laboratorios, herramientas, ciclos] = await Promise.all([
    cargarProfesores(),
    cargarLaboratorios(),
    cargarHerramientas(),
    cargarCiclos()
  ]);

  llenarSelect(selectProfesor, profesores, "nombre");
  llenarSelect(selectLaboratorio, laboratorios, "nombre");
  llenarCiclos(ciclos);
  precargarSelects();

  herramientasDisponibles = herramientas;
  renderizarHerramientas(herramientas);
}

// Inserta los ciclos (Firestore + respaldo) antes de la opción fija
// "+ Agregar ciclo nuevo…", y preselecciona el guardado o el más reciente.
function llenarCiclos(ciclos) {
  const opcionNueva = selectCiclo.querySelector('option[value="__nuevo__"]');
  ciclos.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.nombre;
    opt.textContent = c.actual ? `${c.nombre} (actual)` : c.nombre;
    selectCiclo.insertBefore(opt, opcionNueva);
  });

  const datos = obtenerDatosGuardados();
  const cicloActual = ciclos.find(c => c.actual === true);
  if (datos?.ciclo && [...selectCiclo.options].some(o => o.value === datos.ciclo)) {
    selectCiclo.value = datos.ciclo;
  } else if (cicloActual) {
    selectCiclo.value = cicloActual.nombre;
  } else if (ciclos[0]) {
    selectCiclo.value = ciclos[0].nombre;
  }
}

// Permite escribir un ciclo que no está en la lista (ej. cuando empiece
// 2027-2). Queda guardado en Firestore para que aparezca para todos.
selectCiclo.addEventListener("change", async () => {
  if (selectCiclo.value !== "__nuevo__") return;

  const escrito = prompt("Escribe el nuevo ciclo (ejemplo: 1-2027):");
  const limpio = sanitizar((escrito || "").trim());

  if (!limpio) { selectCiclo.value = ""; return; }

  // Solo se acepta el formato "N-AAAA" (ej. 1-2027) — evita que se cuele
  // cualquier otro texto en una colección que ven todos los estudiantes.
  if (!/^\d{1,2}-\d{4}$/.test(limpio)) {
    mostrarError("Formato de ciclo inválido. Usa el formato N-AAAA, ej. 1-2027.");
    selectCiclo.value = "";
    return;
  }

  const yaExiste = [...selectCiclo.options].find(o => o.value.toLowerCase() === limpio.toLowerCase());
  if (yaExiste) { selectCiclo.value = yaExiste.value; guardarDatosPersonales(); return; }

  const nuevo = await agregarCicloNuevo(limpio);
  if (!nuevo) { selectCiclo.value = ""; return; }

  const opt = document.createElement("option");
  opt.value = nuevo.nombre;
  opt.textContent = nuevo.nombre;
  selectCiclo.insertBefore(opt, selectCiclo.querySelector('option[value="__nuevo__"]'));
  selectCiclo.value = nuevo.nombre;
  guardarDatosPersonales();
});

function validarFormulario() {
  if (selectTipo.value === "adicional") {
    const matricula = inputMatriculaAdicional.value.trim();
    if (!matricula) {
      mostrarError("Ingresa tu matrícula en el campo correspondiente.");
      inputMatriculaAdicional.focus();
      return false;
    }
    if (!/^\d-\d{2}-\d{4}$/.test(matricula)) {
      mostrarError("La matrícula debe tener el formato 0-00-0000 (ej. 1-19-0117).");
      inputMatriculaAdicional.focus();
      return false;
    }
    return true;
  }

  const requeridos = ["nombre", "apellido", "matricula", "ciclo", "telefono", "profesor", "laboratorio"];
  for (const id of requeridos) {
    const campo = document.getElementById(id);
    if (!campo.value.trim()) {
      campo.classList.add("error-campo");
      mostrarError("Completa todos los campos obligatorios.");
      campo.focus();
      return false;
    }
    campo.classList.remove("error-campo");
  }

  const campoMatricula = document.getElementById("matricula");
  const regexMatricula = /^\d-\d{2}-\d{4}$/;
  if (!regexMatricula.test(campoMatricula.value.trim())) {
    campoMatricula.classList.add("error-campo");
    mostrarError("La matrícula debe tener el formato 0-00-0000 (ej. 1-19-0117).");
    campoMatricula.focus();
    return false;
  }
  campoMatricula.classList.remove("error-campo");

  const campoTelefono = document.getElementById("telefono");
  const telefonoLimpio = campoTelefono.value.trim().replace(/[\s-]/g, "");
  const regexTelefono = /^(809|829|849)\d{7}$/;
  if (!regexTelefono.test(telefonoLimpio)) {
    campoTelefono.classList.add("error-campo");
    mostrarError("El teléfono debe ser un número dominicano válido (809/829/849 + 7 dígitos).");
    campoTelefono.focus();
    return false;
  }
  campoTelefono.classList.remove("error-campo");

  const herramientasElegidas = Object.entries(cantidadesSeleccionadas).filter(([_, c]) => c > 0);
  if (herramientasElegidas.length === 0) {
    mostrarError("Selecciona al menos una herramienta.");
    return false;
  }

  return true;
}

// ---- Verificar matrícula duplicada hoy ----
async function buscarSolicitudActivaHoy(matricula) {
  try {
    const snap = await getDoc(doc(db, "activaHoy", matricula));
    if (!snap.exists()) return null;

    const data = snap.data();
    if (data.estado !== "pendiente" && data.estado !== "entregada") return null;
    const ts = (data.creadoEn || data.actualizadoEn)?.toDate?.();
    if (ts && ts.toDateString() !== new Date().toDateString()) return null; // ficha vieja de otro día, ya no cuenta

    // activaHoy ya NO trae el ID real de la solicitud (para que nadie con
    // solo la matrícula de otra persona pueda ubicarla y modificarla).
    // El ID + token solo existen en el localStorage del navegador donde
    // se creó la solicitud.
    const local = obtenerTokenLocal(matricula);
    return {
      id: local?.id || null,
      token: local?.token || null,
      soloLectura: !local, // true si esta solicitud existe pero no es "nuestra" en este dispositivo
      herramientas: data.herramientas || [],
      numeroSolicitud: data.numeroSolicitud,
      estado: data.estado,
      matricula
    };
  } catch (err) {
    console.error("Error en buscarSolicitudActivaHoy:", err);
    return null;
  }
}

// ---- Modal de solicitud duplicada ----
function abrirModalDuplicado(solicitud, herramientasDisp) {
  solicitudExistenteId = solicitud.id;
  solicitudExistente = solicitud;
  cantidadesModalExtra = {};

  // Herramientas ya solicitadas
  const listaActual = (solicitud.herramientas || [])
    .map(h => `
      <li style="padding:3px 0;display:flex;align-items:center;gap:6px">
        <span style="color:var(--verde);font-weight:700">${h.cantidad}×</span>
        ${h.nombre}
        ${h.adicional ? '<span style="background:var(--amarillo);color:#333;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px">adicional</span>' : ''}
      </li>`)
    .join("");

  // Grid de herramientas con las mismas clases del formulario
  let gridHtml = "";
  herramientasDisp.forEach(h => {
    const key = claveHerramienta(h);
    cantidadesModalExtra[key] = 0;
    const max = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;
    gridHtml += `
      <div class="tarjeta-herramienta">
        <div class="icono">
          <img src="${h.imagen}" alt="${h.nombre}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="icono-respaldo" style="display:none">${h.icono || "🔧"}</div>
        </div>
        <div class="nombre">${h.nombre}</div>
        <div class="disponible">Disp. ${max}</div>
        <div class="contador">
          <button type="button" data-mcodigo="${key}" data-maccion="restar">−</button>
          <span class="cantidad" id="mcant-${key}">0</span>
          <button type="button" data-mcodigo="${key}" data-maccion="sumar" ${max === 0 ? "disabled" : ""}>+</button>
        </div>
      </div>
    `;
  });

  const modal = document.createElement("div");
  modal.id = "modal-duplicado";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;padding:16px;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,0.18)">

      <!-- Encabezado tipo taller-header -->
      <div style="background:var(--verde-oscuro);border-radius:12px 12px 0 0;padding:18px 20px 14px;text-align:center">
        <div style="font-size:22px;margin-bottom:6px">➕ 🔧</div>
        <h2 style="margin:0;color:#fff;font-size:17px;font-weight:800;line-height:1.3">Agregar herramientas adicionales</h2>
        <p style="margin:6px 0 0;color:#a5d6a7;font-size:13px">
          Solicitud #${solicitud.numeroSolicitud || solicitud.id} &nbsp;·&nbsp;
          Estado: <strong style="color:var(--amarillo)">${solicitud.estado}</strong>
        </p>
      </div>

      <div style="padding:18px 20px">

        <!-- Herramientas ya solicitadas -->
        <div style="background:var(--verde-claro);border:1.5px solid var(--verde-borde);border-radius:8px;padding:12px 16px;margin-bottom:16px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:var(--verde)">📋 Herramientas ya solicitadas:</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--texto);line-height:1.8">
            ${listaActual || '<li style="color:var(--gris)">Ninguna aún</li>'}
          </ul>
        </div>

        <!-- Separador con etiqueta -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="flex:1;height:1px;background:#ddd"></div>
          <span style="font-size:12px;font-weight:700;color:var(--verde);white-space:nowrap">SELECCIONA LAS ADICIONALES</span>
          <div style="flex:1;height:1px;background:#ddd"></div>
        </div>

        <!-- Grid igual al del formulario -->
        <div id="modal-grid-herramientas" class="grid-herramientas" style="margin-bottom:16px">
          ${gridHtml}
        </div>

        <!-- Botones -->
        <div style="display:flex;gap:10px;margin-top:4px">
          <button id="btn-modal-cancelar" style="flex:1;padding:13px;border-radius:8px;border:1.5px solid #c8c8c8;background:#fff;color:var(--gris);font-size:14px;font-weight:600;cursor:pointer">Cancelar</button>
          <button id="btn-modal-agregar" class="btn-enviar" style="flex:2;margin:0">+ Agregar herramientas</button>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // ---- Eventos del grid del modal ----
  document.getElementById("modal-grid-herramientas").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mcodigo]");
    if (!btn) return;
    const codigo = btn.dataset.mcodigo;
    const accion = btn.dataset.maccion;
    const info = herramientasDisp.find(h => claveHerramienta(h) === codigo);
    const maxDisponible = info && Number.isFinite(info.cantidadDisponible) ? info.cantidadDisponible : 5;
    const limiteEstudiante = limiteEstudiantePara(info);
    const max = Math.min(maxDisponible, limiteEstudiante);
    let cant = cantidadesModalExtra[codigo] || 0;
    if (accion === "sumar") {
      if (cant >= max) {
        const msg = maxDisponible < limiteEstudiante
          ? `Solo hay ${maxDisponible} disponible(s).`
          : `Máximo ${limiteEstudiante} unidad(es) por estudiante.`;
        mostrarError(msg);
        return;
      }
      cant += 1;
    }
    if (accion === "restar" && cant > 0) cant -= 1;
    cantidadesModalExtra[codigo] = cant;
    document.getElementById(`mcant-${codigo}`).textContent = cant;
    const cardModal = e.target.closest(".tarjeta-herramienta");
    if (cardModal) cardModal.classList.toggle("seleccionada", cant > 0);
  });

  // ---- Botón Cancelar ----
  document.getElementById("btn-modal-cancelar").addEventListener("click", () => {
    modal.remove();
  });

  // ---- Botón AGREGAR HERRAMIENTAS (CON MARCADOR "adicional: true") ----
  document.getElementById("btn-modal-agregar").addEventListener("click", async () => {
    const nuevas = Object.entries(cantidadesModalExtra)
      .filter(([_, c]) => c > 0)
      .map(([codigo, cantidad]) => {
        const info = herramientasDisp.find(h => claveHerramienta(h) === codigo);
        return { 
          codigo, 
          nombre: info ? info.nombre : codigo, 
          cantidad,
          adicional: true  // 👈 MARCADOR: indica que fue agregada después
        };
      });

    if (nuevas.length === 0) {
      mostrarError("Selecciona al menos una herramienta para agregar.");
      return;
    }

    const btnAgregar = document.getElementById("btn-modal-agregar");
    btnAgregar.disabled = true;
    btnAgregar.textContent = "Guardando...";

    try {
      const existentes = solicitudExistente.herramientas || [];
      const mapa = {};
      
      // Mantener las existentes (incluyendo su propiedad 'adicional' si la tienen)
      existentes.forEach(h => { 
        mapa[h.codigo] = { ...h }; 
      });
      
      // Agregar o sumar nuevas (con adicional: true)
      nuevas.forEach(h => {
        if (mapa[h.codigo]) {
          mapa[h.codigo].cantidad += h.cantidad;
          // Si ya existía pero no tenía el marcador, se lo ponemos
          mapa[h.codigo].adicional = true;
        } else {
          mapa[h.codigo] = { ...h };
        }
      });

      const listaActualizada = Object.values(mapa);

      // Una vez que la solicitud ya fue entregada, el panel admin deja de
      // mirar el campo "herramientas" y usa "herramientasEntregadas" en su
      // lugar (para no perder el detalle de qué se entregó realmente). Si
      // no sincronizamos los dos campos aquí, lo que el estudiante agregue
      // después de la entrega queda guardado pero invisible para el panel.
      const datosActualizacion = {
        herramientas: listaActualizada,
        tokenUsado: solicitudExistente.token
      };
      if (solicitudExistente.estado === "entregada") {
        datosActualizacion.herramientasEntregadas = listaActualizada.map(h =>
          h.estadoEntrega ? h : { ...h, estadoEntrega: "entregada" }
        );
      }

      await updateDoc(doc(db, "solicitudes", solicitudExistenteId), datosActualizacion);

      try {
        await updateDoc(doc(db, "activaHoy", solicitudExistente.matricula), {
          herramientas: listaActualizada,  
          actualizadoEn: serverTimestamp()
        });
      } catch (errFicha) {
        console.error("No se pudo actualizar la ficha activaHoy:", errFicha);
      }

      modal.remove();
      textoNumeroSol.textContent = `Solicitud #${solicitudExistente.numeroSolicitud || solicitudExistenteId}`;
      textoDespedida.textContent = `Se agregaron ${nuevas.length} herramienta(s) adicional(es) a tu solicitud activa.`;
      mostrarPantalla(pantallaFinal);
      
    } catch (err) {
      console.error("Error al agregar herramientas:", err);
      if (err.code === "permission-denied") {
        mostrarError("Esta solicitud ya no está activa (puede que ya haya sido retornada). Actualiza la página para hacer una solicitud nueva si necesitas más herramientas.");
      } else {
        mostrarError("No se pudo actualizar la solicitud. Revisa tu conexión.");
      }
      btnAgregar.disabled = false;
      btnAgregar.textContent = "+ Agregar herramientas";
    }
  });
}

async function generarNumeroSolicitud() {
  const anio = new Date().getFullYear();
  const refContador = doc(db, "contadores", String(anio));
  try {
    const siguiente = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(refContador);
      const actual = snap.exists() ? (snap.data().ultimo || 0) : 0;
      const nuevo = actual + 1;
      transaction.set(refContador, { ultimo: nuevo }, { merge: true });
      return nuevo;
    });
    return `${anio}-${String(siguiente).padStart(5, "0")}`;
  } catch (err) {
    console.error("Error generando número de solicitud:", err);
    return `${anio}-${String(Date.now()).slice(-5)}`;
  }
}

btnEnviar.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!validarFormulario()) return;

  btnEnviar.disabled = true;
  btnEnviar.textContent = "Verificando...";

  if (selectTipo.value === "adicional") {
    btnEnviar.disabled = false;
    btnEnviar.textContent = "Enviar Solicitud";
    mostrarError("Usa el botón 'Buscar solicitud activa' para agregar herramientas.");
    return;
  }

  const matricula = document.getElementById("matricula").value.trim();

  try {
    const solicitudActiva = await buscarSolicitudActivaHoy(matricula);
    if (solicitudActiva) {
      btnEnviar.disabled = false;
      btnEnviar.textContent = "Enviar Solicitud";
      const quiereAgregar = await confirmarPersonalizado(
        "Ya tienes una solicitud activa hoy.\n¿Quieres agregar herramientas a esa solicitud?",
        { titulo: "Solicitud ya existente", icono: "⚠️", textoSi: "Sí, agregar", textoNo: "No, cancelar" }
      );
      if (quiereAgregar) {
        abrirModalDuplicado(solicitudActiva, herramientasDisponibles);
      }
      return; // Nunca se crea una solicitud nueva cuando ya hay una activa hoy.
    }
  } catch (err) {
    console.error("Error al verificar matrícula:", err);
  }

  const herramientasElegidas = Object.entries(cantidadesSeleccionadas)
    .filter(([_, c]) => c > 0)
    .map(([codigo, cantidad]) => {
      const info = herramientasDisponibles.find(h => claveHerramienta(h) === codigo);
      return { 
        codigo, 
        nombre: info ? info.nombre : codigo, 
        cantidad,
        adicional: false  // Las de la solicitud original no son adicionales
      };
    });

  datosSolicitudPendiente = {
    nombre:       document.getElementById("nombre").value.trim(),
    apellido:     document.getElementById("apellido").value.trim(),
    matricula:    document.getElementById("matricula").value.trim(),
    ciclo:        document.getElementById("ciclo").value,
    telefono:     document.getElementById("telefono").value.trim(),
    profesor:     document.getElementById("profesor").value,
    laboratorio:  document.getElementById("laboratorio").value,
    herramientas: herramientasElegidas,
    fotoCarnet:   fotoCarnetBase64 || null,
    estado:       "pendiente",
    token:        generarToken(),
    creadoEn:     serverTimestamp()
  };

  mostrarPantalla(pantallaEpp);
  guardarDatosPersonales();
  btnEnviar.disabled = false;
  btnEnviar.textContent = "Enviar Solicitud";
});

btnContinuar.addEventListener("click", async () => {
  btnContinuar.disabled = true;
  btnContinuar.textContent = "Guardando...";

  try {
    const numero = await generarNumeroSolicitud();
    datosSolicitudPendiente.numeroSolicitud = numero;
    const refNueva = await addDoc(collection(db, "solicitudes"), datosSolicitudPendiente);
    guardarTokenLocal(datosSolicitudPendiente.matricula, refNueva.id, datosSolicitudPendiente.token);

    try {
      await setDoc(doc(db, "activaHoy", datosSolicitudPendiente.matricula), {
        estado: "pendiente",
        herramientas: datosSolicitudPendiente.herramientas,
        numeroSolicitud: numero,
        creadoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp()
      });
    } catch (errFicha) {
      console.error("No se pudo actualizar la ficha activaHoy:", errFicha);
      // No bloquea el envío: la solicitud principal ya quedó guardada.
    }

    textoNumeroSol.textContent = `Solicitud #${numero}`;
    textoDespedida.textContent = `Gracias, ${datosSolicitudPendiente.nombre}. Tu solicitud de herramientas ha sido registrada exitosamente.`;

    mostrarPantalla(pantallaFinal);
  } catch (err) {
    console.error(err);
    mostrarError("No se pudo guardar la solicitud. Verifica tu conexión o la configuración de Firebase.");
  } finally {
    btnContinuar.disabled = false;
    btnContinuar.textContent = "Continuar";
  }
});

btnNuevaSolicitud.addEventListener("click", () => {
  form.reset();
  cantidadesSeleccionadas = {};
  renderizarHerramientas(herramientasDisponibles);
  fotoPreview.src = "";
  inputCamara.value = "";
  fotoPreviewWrap.classList.add("oculto");
  fotoCarnetBase64 = null;
  selectTipo.value = "solicitando";
  toggleSecciones();
  precargarCamposTexto();  // form.reset() borró los inputs; los recuperamos
  precargarSelects();      // ídem para profesor/laboratorio
  const datos = obtenerDatosGuardados();
  if (datos?.ciclo && [...selectCiclo.options].some(o => o.value === datos.ciclo)) {
    selectCiclo.value = datos.ciclo;
  }
  mostrarPantalla(pantallasBienvenida);
});

inicializar();


