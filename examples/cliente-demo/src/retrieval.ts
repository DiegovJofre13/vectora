/**
 * Retrieval mínimo pero real: lee los documentos markdown de ./kb en disco
 * (no hay nada hardcodeado en el código) y hace una búsqueda por
 * solapamiento de palabras clave. No es un vector store — a propósito: el
 * punto de este ejemplo es mostrar el contrato con @vectora/probe, no un
 * pipeline de RAG sofisticado. Un cliente real reemplaza este archivo por
 * su propio retrieval (vector store, búsqueda léxica, lo que ya tenga).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARPETA_KB = join(__dirname, "..", "kb");

export interface DocumentoKb {
  id: string;
  titulo: string;
  contenido: string;
}

function cargarKb(): DocumentoKb[] {
  const archivos = readdirSync(CARPETA_KB).filter((f) => f.endsWith(".md"));
  return archivos.map((archivo) => {
    const texto = readFileSync(join(CARPETA_KB, archivo), "utf8").trim();
    const primeraLinea = texto.split("\n")[0] ?? "";
    const titulo = primeraLinea.replace(/^#+\s*/, "").trim();
    const contenido = texto.slice(primeraLinea.length).trim();
    return { id: archivo.replace(/\.md$/, ""), titulo, contenido };
  });
}

// Se carga una sola vez al arrancar el proceso — son 10 archivos chicos, no amerita cachear con TTL ni recargar en caliente.
const KB = cargarKb();

export function buscarEnKb(pregunta: string, k = 3): DocumentoKb[] {
  const palabrasClave = pregunta
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.,]/g, "")
    .split(/\s+/)
    .filter((p) => p.length > 3);

  const puntuados = KB.map((doc) => {
    const textoDoc = `${doc.titulo} ${doc.contenido}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    const score = palabrasClave.reduce((acc, palabra) => acc + (textoDoc.includes(palabra) ? 1 : 0), 0);
    return { doc, score };
  }).sort((a, b) => b.score - a.score);

  return puntuados.slice(0, k).map((p) => p.doc);
}

export function totalDocumentos(): number {
  return KB.length;
}

export function todosLosDocumentos(): DocumentoKb[] {
  return KB;
}
