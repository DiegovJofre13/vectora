/**
 * Knowledge base ficticio de "Fintech Andina" para el bot de soporte demo.
 * Sirve dos propósitos: (1) fixture real que el bot de soporte usa para
 * retrieval (patrón A), y (2) fuente que el agente generador (Fase 2) lee
 * para producir las ~30 preguntas de evaluación.
 */
export interface DocumentoKb {
  id: string;
  titulo: string;
  contenido: string;
}

export const KB_FINTECH_ANDINA: DocumentoKb[] = [
  {
    id: "kb-devoluciones",
    titulo: "Política de devoluciones",
    contenido:
      "Las devoluciones de transferencias mal dirigidas se procesan en un plazo máximo de 5 días hábiles desde que el usuario reporta el error en la app. Si el destinatario ya retiró los fondos, Fintech Andina no puede garantizar la devolución y el caso se deriva a mediación entre las partes.",
  },
  {
    id: "kb-bloqueo-tarjeta",
    titulo: "Bloqueo y reposición de tarjetas",
    contenido:
      "Una tarjeta se bloquea automáticamente tras 3 intentos fallidos de clave. El usuario puede desbloquearla desde la app con verificación biométrica. Si reporta robo o extravío, el bloqueo es permanente y la reposición física demora entre 5 y 7 días hábiles, sin costo la primera vez al año.",
  },
  {
    id: "kb-limites-transferencia",
    titulo: "Límites de transferencia",
    contenido:
      "El límite diario de transferencias para cuentas verificadas es de 5.000.000 CLP. Cuentas sin verificación de identidad completa tienen un límite de 500.000 CLP diarios. El límite puede aumentarse temporalmente contactando a soporte con justificación del monto.",
  },
  {
    id: "kb-tiempos-acreditacion",
    titulo: "Tiempos de acreditación",
    contenido:
      "Las transferencias entre cuentas Fintech Andina son instantáneas. Las transferencias a otros bancos vía SINACOFI se acreditan en un plazo de hasta 24 horas hábiles. Los depósitos por cheque demoran 3 días hábiles en liberarse.",
  },
  {
    id: "kb-tasas-interes",
    titulo: "Tasas de interés en línea de crédito",
    contenido:
      "La línea de crédito tiene una tasa de interés mensual que varía entre 1,2% y 2,8% según el perfil de riesgo del usuario, calculado con historial de pagos y antigüedad de la cuenta. La tasa se informa en la app antes de aceptar cualquier giro.",
  },
  {
    id: "kb-disputas-cobro",
    titulo: "Disputa de cobros no reconocidos",
    contenido:
      "Un usuario puede disputar un cargo no reconocido desde la app en un plazo de hasta 60 días desde la fecha del cargo. Fintech Andina abre una investigación con el comercio y, si corresponde, hace un abono provisional dentro de 10 días hábiles mientras se resuelve.",
  },
  {
    id: "kb-cuenta-remunerada",
    titulo: "Cuenta remunerada",
    contenido:
      "La cuenta remunerada paga un interés diario sobre el saldo promedio, con una tasa anual referencial de 4,5%, sujeta a cambios mensuales que se notifican con 15 días de anticipación. El interés se abona el primer día hábil de cada mes.",
  },
  {
    id: "kb-cierre-cuenta",
    titulo: "Cierre de cuenta",
    contenido:
      "El cierre de cuenta se puede solicitar desde la app sin costo, siempre que no existan saldos pendientes en la línea de crédito. El proceso demora 48 horas hábiles y el usuario recibe confirmación por correo. Los fondos remanentes se transfieren a una cuenta de respaldo declarada por el usuario.",
  },
  {
    id: "kb-verificacion-identidad",
    titulo: "Verificación de identidad",
    contenido:
      "La verificación de identidad requiere cédula vigente y una selfie con prueba de vida, validada en menos de 5 minutos en el 90% de los casos. Sin verificación completa, la cuenta opera en modo restringido con límites reducidos y sin acceso a línea de crédito.",
  },
  {
    id: "kb-soporte-prioritario",
    titulo: "Soporte prioritario",
    contenido:
      "Los usuarios con cuenta remunerada o línea de crédito activa acceden a una cola de soporte prioritaria con tiempo de respuesta objetivo de 3 minutos. El resto de los usuarios tiene un tiempo objetivo de 15 minutos en horario hábil.",
  },
];

export function buscarEnKb(pregunta: string, k = 3): DocumentoKb[] {
  const palabrasClave = pregunta
    .toLowerCase()
    .replace(/[¿?¡!.,]/g, "")
    .split(/\s+/)
    .filter((p) => p.length > 3);

  const puntuados = KB_FINTECH_ANDINA.map((doc) => {
    const textoDoc = `${doc.titulo} ${doc.contenido}`.toLowerCase();
    const score = palabrasClave.reduce((acc, palabra) => acc + (textoDoc.includes(palabra) ? 1 : 0), 0);
    return { doc, score };
  }).sort((a, b) => b.score - a.score);

  return puntuados.slice(0, k).map((p) => p.doc);
}
