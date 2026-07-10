/**
 * Limitador de concurrencia mínimo, sin dependencias externas. Usado para
 * correr la evaluación con rate limiting (spec: "corre con rate limiting"),
 * evitando disparar las ~150 llamadas al sistema del cliente todas a la vez.
 */
export function crearLimitador(concurrenciaMaxima: number) {
  let activas = 0;
  const cola: (() => void)[] = [];

  function siguiente() {
    if (activas >= concurrenciaMaxima) return;
    const tarea = cola.shift();
    if (!tarea) return;
    activas++;
    tarea();
  }

  return function limitar<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      cola.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            activas--;
            siguiente();
          });
      });
      siguiente();
    });
  };
}
