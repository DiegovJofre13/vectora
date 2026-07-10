/**
 * Datos y sintetizadores del seed de "Fintech Andina". Separado de seed.ts
 * para mantener el script principal legible. Todo lo que aquí se genera es
 * síncrono y determinista-ish (RNG con semilla fija): el seed no debe
 * depender del motor Mock en vivo (que sí usa timers reales) para poder
 * poblar ~200+ filas al instante.
 */
import { CATALOGO_MODELOS, type ModeloCatalogo } from "../src/engine/modelCatalog.js";
import { KB_FINTECH_ANDINA, type DocumentoKb } from "../src/demo/fintechAndinaKb.js";

// --- RNG con semilla fija, para que el seed sea reproducible entre corridas ---
export function crearRng(semilla: number): () => number {
  let s = semilla;
  return function mulberry32() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PreguntaSeed {
  pregunta: string;
  dificultad: "simple" | "multi_hop" | "razonamiento";
  kbIds: string[];
  respuestaEsperadaProvisional: string;
}

function kb(id: string): DocumentoKb {
  const doc = KB_FINTECH_ANDINA.find((d) => d.id === id);
  if (!doc) throw new Error(`KB doc no encontrado: ${id}`);
  return doc;
}

export const PREGUNTAS_BOT_SOPORTE: PreguntaSeed[] = [
  { pregunta: "¿Cuánto demora la devolución de una transferencia mal dirigida?", dificultad: "simple", kbIds: ["kb-devoluciones"], respuestaEsperadaProvisional: "Hasta 5 días hábiles desde que se reporta el error en la app, salvo que el destinatario ya haya retirado los fondos." },
  { pregunta: "Si el destinatario de una transferencia errónea ya retiró la plata, ¿Fintech Andina me la devuelve igual?", dificultad: "razonamiento", kbIds: ["kb-devoluciones"], respuestaEsperadaProvisional: "No se puede garantizar; el caso se deriva a mediación entre las partes." },
  { pregunta: "¿Cuántos intentos fallidos de clave bloquean mi tarjeta?", dificultad: "simple", kbIds: ["kb-bloqueo-tarjeta"], respuestaEsperadaProvisional: "3 intentos fallidos." },
  { pregunta: "Perdí mi tarjeta, ¿cuánto tarda la reposición y tiene costo?", dificultad: "simple", kbIds: ["kb-bloqueo-tarjeta"], respuestaEsperadaProvisional: "Entre 5 y 7 días hábiles, sin costo la primera vez al año." },
  { pregunta: "¿Cuál es el límite diario de transferencia si aún no verifico mi identidad?", dificultad: "simple", kbIds: ["kb-limites-transferencia"], respuestaEsperadaProvisional: "500.000 CLP diarios sin verificación completa." },
  { pregunta: "Tengo cuenta verificada y quiero transferir 4.500.000 CLP hoy, ¿puedo?", dificultad: "razonamiento", kbIds: ["kb-limites-transferencia"], respuestaEsperadaProvisional: "Sí, el límite diario para cuentas verificadas es 5.000.000 CLP." },
  { pregunta: "¿Las transferencias a otros bancos son instantáneas?", dificultad: "simple", kbIds: ["kb-tiempos-acreditacion"], respuestaEsperadaProvisional: "No; entre cuentas Fintech Andina sí son instantáneas, pero a otros bancos vía SINACOFI demoran hasta 24 horas hábiles." },
  { pregunta: "Deposité un cheque, ¿cuándo puedo usar la plata?", dificultad: "simple", kbIds: ["kb-tiempos-acreditacion"], respuestaEsperadaProvisional: "Los depósitos por cheque demoran 3 días hábiles en liberarse." },
  { pregunta: "¿Cómo se calcula la tasa de interés de la línea de crédito?", dificultad: "simple", kbIds: ["kb-tasas-interes"], respuestaEsperadaProvisional: "Entre 1,2% y 2,8% mensual según perfil de riesgo, historial de pagos y antigüedad de la cuenta." },
  { pregunta: "Si tengo mal historial de pagos, ¿me conviene usar la línea de crédito o mejor esperar?", dificultad: "razonamiento", kbIds: ["kb-tasas-interes"], respuestaEsperadaProvisional: "La tasa dependerá del perfil de riesgo; con mal historial probablemente se acerque al techo de 2,8% mensual, conviene revisar la tasa informada en la app antes de girar." },
  { pregunta: "Vi un cargo que no reconozco de hace 40 días, ¿todavía puedo reclamarlo?", dificultad: "razonamiento", kbIds: ["kb-disputas-cobro"], respuestaEsperadaProvisional: "Sí, el plazo para disputar es de hasta 60 días desde la fecha del cargo." },
  { pregunta: "¿Cuánto demora el abono provisional en una disputa de cobro?", dificultad: "simple", kbIds: ["kb-disputas-cobro"], respuestaEsperadaProvisional: "Hasta 10 días hábiles mientras se resuelve la investigación." },
  { pregunta: "¿Qué tasa anual paga la cuenta remunerada?", dificultad: "simple", kbIds: ["kb-cuenta-remunerada"], respuestaEsperadaProvisional: "Una tasa anual referencial de 4,5%, sujeta a cambios mensuales notificados con 15 días de anticipación." },
  { pregunta: "¿Cuándo se abona el interés de la cuenta remunerada?", dificultad: "simple", kbIds: ["kb-cuenta-remunerada"], respuestaEsperadaProvisional: "El primer día hábil de cada mes." },
  { pregunta: "Quiero cerrar mi cuenta pero tengo un saldo pendiente en la línea de crédito, ¿puedo?", dificultad: "razonamiento", kbIds: ["kb-cierre-cuenta"], respuestaEsperadaProvisional: "No, el cierre requiere no tener saldos pendientes en la línea de crédito." },
  { pregunta: "¿Cuánto demora el cierre de cuenta y qué pasa con la plata que me queda?", dificultad: "multi_hop", kbIds: ["kb-cierre-cuenta"], respuestaEsperadaProvisional: "El proceso demora 48 horas hábiles y los fondos remanentes se transfieren a una cuenta de respaldo declarada por el usuario." },
  { pregunta: "¿Qué necesito para verificar mi identidad y cuánto demora?", dificultad: "simple", kbIds: ["kb-verificacion-identidad"], respuestaEsperadaProvisional: "Cédula vigente y una selfie con prueba de vida; se valida en menos de 5 minutos en el 90% de los casos." },
  { pregunta: "No he verificado mi identidad, ¿puedo acceder a la línea de crédito?", dificultad: "multi_hop", kbIds: ["kb-verificacion-identidad", "kb-tasas-interes"], respuestaEsperadaProvisional: "No; sin verificación completa la cuenta opera en modo restringido, sin acceso a línea de crédito." },
  { pregunta: "¿Cuánto se demora el soporte en atenderme si tengo cuenta remunerada?", dificultad: "multi_hop", kbIds: ["kb-soporte-prioritario", "kb-cuenta-remunerada"], respuestaEsperadaProvisional: "Los usuarios con cuenta remunerada acceden a cola prioritaria con tiempo objetivo de 3 minutos." },
  { pregunta: "Tengo línea de crédito activa, ¿tengo soporte prioritario?", dificultad: "simple", kbIds: ["kb-soporte-prioritario"], respuestaEsperadaProvisional: "Sí, los usuarios con línea de crédito activa acceden a la cola de soporte prioritaria." },
  { pregunta: "Si mi cuenta está en modo restringido, ¿puedo transferir el límite completo de 5.000.000 CLP?", dificultad: "multi_hop", kbIds: ["kb-verificacion-identidad", "kb-limites-transferencia"], respuestaEsperadaProvisional: "No, en modo restringido (sin verificación completa) el límite diario baja a 500.000 CLP." },
  { pregunta: "¿Qué pasa si mi tarjeta se bloquea por intentos fallidos de clave, puedo desbloquearla yo mismo?", dificultad: "simple", kbIds: ["kb-bloqueo-tarjeta"], respuestaEsperadaProvisional: "Sí, se puede desbloquear desde la app con verificación biométrica." },
  { pregunta: "¿La reposición de tarjeta por robo tiene el mismo plazo que por extravío?", dificultad: "razonamiento", kbIds: ["kb-bloqueo-tarjeta"], respuestaEsperadaProvisional: "Sí, en ambos casos el bloqueo es permanente y la reposición demora entre 5 y 7 días hábiles." },
  { pregunta: "¿Puedo aumentar mi límite de transferencia diario?", dificultad: "simple", kbIds: ["kb-limites-transferencia"], respuestaEsperadaProvisional: "Sí, contactando a soporte con justificación del monto se puede aumentar temporalmente." },
  { pregunta: "¿Cambia la tasa de la cuenta remunerada sin avisar?", dificultad: "simple", kbIds: ["kb-cuenta-remunerada"], respuestaEsperadaProvisional: "No, cualquier cambio se notifica con 15 días de anticipación." },
  { pregunta: "¿Cuál es el tiempo objetivo de soporte para un usuario sin cuenta remunerada ni línea de crédito?", dificultad: "simple", kbIds: ["kb-soporte-prioritario"], respuestaEsperadaProvisional: "15 minutos en horario hábil." },
  { pregunta: "Reporté mi tarjeta como robada hace 6 días, ¿ya debería haberla recibido?", dificultad: "razonamiento", kbIds: ["kb-bloqueo-tarjeta"], respuestaEsperadaProvisional: "Está dentro del rango normal, ya que el plazo es de 5 a 7 días hábiles." },
  { pregunta: "¿Qué documentos necesito si mi cuenta quedó en modo restringido y quiero salir de ese estado?", dificultad: "multi_hop", kbIds: ["kb-verificacion-identidad"], respuestaEsperadaProvisional: "Cédula vigente y una selfie con prueba de vida para completar la verificación de identidad." },
  { pregunta: "¿La disputa de un cobro no reconocido me asegura que me devuelvan la plata?", dificultad: "razonamiento", kbIds: ["kb-disputas-cobro"], respuestaEsperadaProvisional: "No asegura el resultado final, pero sí un abono provisional dentro de 10 días hábiles mientras se investiga." },
  { pregunta: "¿Puedo cerrar mi cuenta remunerada el mismo día que la abro?", dificultad: "multi_hop", kbIds: ["kb-cierre-cuenta", "kb-cuenta-remunerada"], respuestaEsperadaProvisional: "Sí, siempre que no existan saldos pendientes en la línea de crédito; el cierre demora 48 horas hábiles." },
];

export function docsDeContexto(preg: PreguntaSeed): DocumentoKb[] {
  return preg.kbIds.map(kb);
}

// --- Sintetizador de respuestas por tier, para poblar resultados históricos sin llamar al motor Mock en vivo ---
export function sintetizarRespuestaSeed(rng: () => number, tier: ModeloCatalogo["tier"], preg: PreguntaSeed): { texto: string; acierto: boolean } {
  const probAcierto = { frontera: 0.95, intermedio: 0.87, barato: 0.74, open: 0.78 }[tier];
  const acierto = rng() < probAcierto;
  if (acierto) {
    return { texto: preg.respuestaEsperadaProvisional, acierto };
  }
  return {
    texto: "No cuento con información suficiente en el contexto para responder con precisión, pero en general estos casos se resuelven revisando la política vigente.",
    acierto,
  };
}

export function sintetizarScoresJuez(rng: () => number, tier: ModeloCatalogo["tier"], acierto: boolean) {
  const base = { frontera: 0.95, intermedio: 0.88, barato: 0.76, open: 0.8 }[tier];
  const penalizacion = acierto ? 0 : 0.35;
  const jitter = () => Math.max(0, Math.min(1, base - penalizacion + (rng() - 0.5) * 0.12));
  const groundedness = jitter();
  const relevancia = jitter();
  const completitud = jitter();
  const promedio = Number(((groundedness * 0.5 + relevancia * 0.3 + completitud * 0.2)).toFixed(3));
  return { groundedness: Number(groundedness.toFixed(3)), relevancia: Number(relevancia.toFixed(3)), completitud: Number(completitud.toFixed(3)), promedio };
}

export function sintetizarConfianzaJuez(rng: () => number, forzarBaja: boolean): number {
  if (forzarBaja) return Number((0.35 + rng() * 0.28).toFixed(3)); // < 0.65
  return Number((0.68 + rng() * 0.3).toFixed(3));
}

export function latenciaConJitter(rng: () => number, base: number): number {
  const factor = 0.8 + rng() * 0.4;
  return Math.round(base * factor);
}

export function costoEstimado(modelo: ModeloCatalogo, textoEntrada: string, textoSalida: string): number {
  const tokensEst = (textoEntrada.length + textoSalida.length) / 4;
  return Number(((tokensEst / 1000) * modelo.precioPor1KUsd).toFixed(6));
}

export const MODELOS = CATALOGO_MODELOS;
