const API_URL = import.meta.env["VITE_API_URL"] ?? "http://localhost:4310";

export interface CasoDeUsoResumen {
  id: string;
  nombre: string;
  descripcion: string;
  tipoTarea: string;
  estado: string;
  modeloProduccion: string | null;
  costoMensualProduccion: number | null;
  volumenMensual: number | null;
}

export async function obtenerSalud(): Promise<{ ok: boolean; organizaciones: number; version: string }> {
  const res = await fetch(`${API_URL}/api/salud`);
  if (!res.ok) throw new Error("No se pudo conectar al server de Vectora");
  return res.json();
}

export async function listarCasosDeUso(): Promise<CasoDeUsoResumen[]> {
  const res = await fetch(`${API_URL}/api/casos-de-uso`);
  if (!res.ok) throw new Error("No se pudieron cargar los casos de uso");
  const data = await res.json();
  return data.casos;
}
