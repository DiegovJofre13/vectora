import { db } from "../lib/db.js";
import { generarApiKeyGateway } from "../lib/apiKeys.js";

/** Genera y persiste el apiKeyGateway de una organización si todavía no tiene uno
 * (organizaciones creadas antes de este campo, o recién creadas). */
export async function obtenerOCrearApiKeyGateway(organizacionId: string): Promise<string> {
  const org = await db.organizacion.findUniqueOrThrow({ where: { id: organizacionId } });
  if (org.apiKeyGateway) return org.apiKeyGateway;

  const apiKey = generarApiKeyGateway();
  await db.organizacion.update({ where: { id: organizacionId }, data: { apiKeyGateway: apiKey } });
  return apiKey;
}

export async function buscarOrganizacionPorApiKey(apiKey: string) {
  return db.organizacion.findUnique({ where: { apiKeyGateway: apiKey } });
}

export async function cargarCreditos(organizacionId: string, montoUsd: number, descripcion: string): Promise<void> {
  if (montoUsd <= 0) throw new Error("El monto a cargar debe ser positivo.");
  await db.$transaction([
    db.organizacion.update({ where: { id: organizacionId }, data: { saldoCreditosUsd: { increment: montoUsd } } }),
    db.movimientoCreditos.create({
      data: { organizacionId, tipo: "carga", montoUsd: Number(montoUsd.toFixed(6)), descripcion },
    }),
  ]);
}

export async function registrarConsumo(params: {
  organizacionId: string;
  evaluacionCorridaId?: string;
  costoBaseUsd: number;
  margenUsd: number;
  descripcion: string;
}): Promise<void> {
  const totalUsd = Number((params.costoBaseUsd + params.margenUsd).toFixed(6));
  await db.$transaction([
    db.organizacion.update({ where: { id: params.organizacionId }, data: { saldoCreditosUsd: { decrement: totalUsd } } }),
    db.movimientoCreditos.create({
      data: {
        organizacionId: params.organizacionId,
        evaluacionCorridaId: params.evaluacionCorridaId,
        tipo: "consumo",
        montoUsd: totalUsd,
        costoBaseUsd: Number(params.costoBaseUsd.toFixed(6)),
        margenUsd: Number(params.margenUsd.toFixed(6)),
        descripcion: params.descripcion,
      },
    }),
  ]);
}

export async function verificarSaldoSuficiente(organizacionId: string, montoRequeridoUsd: number): Promise<boolean> {
  const org = await db.organizacion.findUniqueOrThrow({ where: { id: organizacionId } });
  return org.saldoCreditosUsd >= montoRequeridoUsd;
}

export interface ResumenCreditos {
  saldoUsd: number;
  apiKeyGateway: string;
  movimientos: {
    id: string;
    tipo: string;
    montoUsd: number;
    costoBaseUsd: number | null;
    margenUsd: number | null;
    descripcion: string;
    createdAt: Date;
  }[];
}

export async function obtenerResumenCreditos(organizacionId: string): Promise<ResumenCreditos> {
  const apiKeyGateway = await obtenerOCrearApiKeyGateway(organizacionId);
  const org = await db.organizacion.findUniqueOrThrow({ where: { id: organizacionId } });
  const movimientos = await db.movimientoCreditos.findMany({
    where: { organizacionId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { saldoUsd: org.saldoCreditosUsd, apiKeyGateway, movimientos };
}
