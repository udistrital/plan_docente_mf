export const HORAS_REQUERIDAS_POR_VINCULACION: Record<string, number> = {
  293: 40, // Carrera tiempo completo
  294: 20, // Carrera medio tiempo
  296: 40, // Tiempo completo ocasional
  298: 20, // Medio tiempo ocasional
  299: 8, // Hora catedra por honorarios (HCH)
};

export interface ValidacionHorasPlanDocente {
  codigoAbreviacion: string | null;
  totalHoras: number;
  horasRequeridas: number | null;
}

function normalizarTexto(valor: string): string {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function obtenerCandidatosVinculacion(planDocente: any): string[] {
  const vinculacion = planDocente?.tipo_vinculacion;

  if (Array.isArray(vinculacion)) {
    return vinculacion.flatMap((item: any) => [
      String(item?.id ?? item?._id ?? "").trim(),
      String(item?.codigo_abreviacion ?? item?.CodigoAbreviacion ?? "").trim(),
      String(item?.nombre ?? item?.Nombre ?? "").trim(),
    ]);
  }

  return [
    String(vinculacion?.id ?? vinculacion?._id ?? vinculacion ?? "").trim(),
    String(vinculacion?.codigo_abreviacion ?? vinculacion?.CodigoAbreviacion ?? "").trim(),
    String(vinculacion?.nombre ?? vinculacion?.Nombre ?? "").trim(),
  ];
}

export function obtenerTotalHorasPlanDocente(planDocente: any): number {
  const seleccion = Number(planDocente?.seleccion || 0);
  const cargaItems = Array.isArray(planDocente?.carga?.[seleccion])
    ? planDocente.carga[seleccion]
    : Array.isArray(planDocente?.carga?.[0])
      ? planDocente.carga[0]
      : [];

  return cargaItems.reduce((totalHoras: number, item: any) => {
    const horas = Number(item?.horario?.horas);
    return totalHoras + (Number.isNaN(horas) ? 0 : horas);
  }, 0);
}

export function obtenerCodigoAbreviacionVinculacion(planDocente: any): string | null {
  const candidatos = obtenerCandidatosVinculacion(planDocente);

  for (const candidato of candidatos) {
    if (candidato) {
      return candidato;
    }
  }

  return null;
}

export function obtenerHorasRequeridasVinculacion(
  codigoAbreviacion: string | null | undefined
): number | null {
  if (!codigoAbreviacion) {
    return null;
  }

  const valorNormalizado = normalizarTexto(codigoAbreviacion);

  if (codigoAbreviacion in HORAS_REQUERIDAS_POR_VINCULACION) {
    return HORAS_REQUERIDAS_POR_VINCULACION[codigoAbreviacion];
  }

  for (const [clave, horas] of Object.entries(HORAS_REQUERIDAS_POR_VINCULACION)) {
    if (normalizarTexto(clave) === valorNormalizado) {
      return horas;
    }
  }

  return null;
}

export function validarHorasPlanDocentePorVinculacion(
  planDocente: any,
  codigoAbreviacionOVinculacionId?: string | null
): ValidacionHorasPlanDocente {
  const codigoAbreviacion = codigoAbreviacionOVinculacionId?.trim()
    ? codigoAbreviacionOVinculacionId.trim()
    : obtenerCodigoAbreviacionVinculacion(planDocente);

  return {
    codigoAbreviacion,
    totalHoras: obtenerTotalHorasPlanDocente(planDocente),
    horasRequeridas: obtenerHorasRequeridasVinculacion(codigoAbreviacion),
  };
}