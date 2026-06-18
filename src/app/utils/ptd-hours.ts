export interface RestriccionHorasVinculacion {
  codigoAbreviacion: string;
  nombre: string;
  registraHorasNoLectivas: boolean;
  horasMinimas: number | null;
  horasMaximas: number;
  alias: string[];
}

/**
 * Variable para almacenar los parámetros obtenidos del servicio
 */
let parametrosCache: any[] = [];

/**
 * Obtiene parámetros desde el servicio y los almacena en caché
 * @param parametroService - Servicio de parámetros inyectado
 * @returns Promise con los parámetros obtenidos
 */
export async function cargarParametros(parametroService: any): Promise<any[]> {
  try {
    const query = "tipoParametroId__CodigoAbreviacion:HSPTD,activo:true";
    const fields = "Id,Nombre,Descripcion,CodigoAbreviacion";
    const url = `parametro?query=${encodeURIComponent(query)}&fields=${fields}`;

    const respuesta = await parametroService.get(url).toPromise();

    if (respuesta?.Success && Array.isArray(respuesta?.Data)) {
      parametrosCache = respuesta.Data;
      return parametrosCache;
    }

    console.warn("No se obtuvieron parámetros del servicio", respuesta);
    return [];
  } catch (error) {
    console.error("Error al cargar parámetros:", error);
    return [];
  }
}

/**
 * Obtiene una propiedad convertida a número desde un código de abreviación
 * @param codigoAbreviacion - Código a buscar
 * @returns Número o null si no se encuentra
 */
export function obtenerValorNumericoDesdeParametro(codigoAbreviacion: string): number{
  if (!codigoAbreviacion || parametrosCache.length === 0) {
    return 0;
  }

  const parametro = parametrosCache.find(
    (p: any) => normalizarTexto(p.CodigoAbreviacion) === normalizarTexto(codigoAbreviacion)
  );

  if (!parametro?.Descripcion) {
    return 0;
  }

  const valor = parseInt(parametro.Descripcion, 10);
  return Number.isNaN(valor) ? 0 : valor;
}

export let RESTRICCIONES_HORAS_POR_VINCULACION: Record<string, RestriccionHorasVinculacion> = {
  DCTC: {
    codigoAbreviacion: "DCTC",
    nombre: "DOCENTE DE CARRERA TIEMPO COMPLETO",
    registraHorasNoLectivas: true,
    horasMinimas: obtenerValorNumericoDesdeParametro("HMINDCTC"),
    horasMaximas: obtenerValorNumericoDesdeParametro("HMAXDCTC"),
    alias: ["CARRERA TIEMPO COMPLETO"],
  },
  TCO: {
    codigoAbreviacion: "TCO",
    nombre: "TIEMPO COMPLETO OCASIONAL",
    registraHorasNoLectivas: true,
    horasMinimas: obtenerValorNumericoDesdeParametro("HMINTCO"),
    horasMaximas: obtenerValorNumericoDesdeParametro("HMAXTCO"),
    alias: [],
  },
  MTO: {
    codigoAbreviacion: "MTO",
    nombre: "MEDIO TIEMPO OCASIONAL",
    registraHorasNoLectivas: true,
    horasMinimas: obtenerValorNumericoDesdeParametro("HMINMTO"),
    horasMaximas: obtenerValorNumericoDesdeParametro("HMAXMTO"),
    alias: [],
  },
  HCH: {
    codigoAbreviacion: "HCH",
    nombre: "DOCENTE HORA CATEDRA POR HONORARIOS",
    registraHorasNoLectivas: false,
    horasMinimas: null,
    horasMaximas: obtenerValorNumericoDesdeParametro("HMAXHC"),
    alias: ["HORA CATEDRA POR HONORARIOS"],
  },
  DCMT: {
    codigoAbreviacion: "DCMT",
    nombre: "DOCENTE DE CARRERA MEDIO TIEMPO",
    registraHorasNoLectivas: true,
    horasMinimas: obtenerValorNumericoDesdeParametro("HMINDCMT"),
    horasMaximas: obtenerValorNumericoDesdeParametro("HMAXDCMTO"),
    alias: ["CARRERA MEDIO TIEMPO"],
  },
};

const INDICE_RESTRICCIONES_HORAS: Record<string, RestriccionHorasVinculacion> =
  Object.values(RESTRICCIONES_HORAS_POR_VINCULACION).reduce(
    (acumulado: Record<string, RestriccionHorasVinculacion>, restriccion) => {
      const claves = [
        restriccion.codigoAbreviacion,
        restriccion.nombre,
        ...(restriccion.alias || []),
      ];

      claves.forEach((clave) => {
        const claveNormalizada = normalizarTexto(clave);
        if (claveNormalizada) {
          acumulado[claveNormalizada] = restriccion;
        }
      });

      return acumulado;
    },
    {}
  );

export interface ValidacionHorasPlanDocente {
  codigoAbreviacion: string | null;
  totalHoras: number;
  horasMinimas: number | null;
  horasMaximas: number | null;
  registraHorasNoLectivas: boolean | null;
  estaEnRango: boolean | null;
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
  const seleccion = Number(planDocente?.seleccion ?? 0);

  if (Array.isArray(vinculacion)) {
    const vinculacionSeleccionada =
      vinculacion[seleccion] !== undefined
        ? [vinculacion[seleccion]]
        : [];
    const vinculacionesRestantes = vinculacion.filter(
      (_: any, idx: number) => idx !== seleccion
    );

    return [...vinculacionSeleccionada, ...vinculacionesRestantes].flatMap((item: any) => [
      String(item?.codigo_abreviacion ?? item?.CodigoAbreviacion ?? "").trim(),
      String(item?.nombre ?? item?.Nombre ?? "").trim(),
    ]);
  }

  return [
    String(vinculacion?.codigo_abreviacion ?? vinculacion?.CodigoAbreviacion ?? vinculacion ?? "").trim(),
    String(vinculacion?.codigo_abreviacion ?? vinculacion?.CodigoAbreviacion ?? "").trim(),
    String(vinculacion?.nombre ?? vinculacion?.Nombre ?? "").trim(),
  ];
}

export function obtenerRestriccionHorasVinculacion(
  codigoAbreviacion: string | null | undefined
): RestriccionHorasVinculacion | null {
  if (!codigoAbreviacion) {
    return null;
  }

  const valorNormalizado = normalizarTexto(codigoAbreviacion);
  return INDICE_RESTRICCIONES_HORAS[valorNormalizado] || null;
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
  return obtenerRestriccionHorasVinculacion(codigoAbreviacion)?.horasMaximas ?? null;
}

function validarHorasEnRango(totalHoras: number, restriccion: RestriccionHorasVinculacion): boolean {
  const cumpleMinimo =
    restriccion.horasMinimas === null || totalHoras >= restriccion.horasMinimas;
  return cumpleMinimo && totalHoras <= restriccion.horasMaximas;
}

export function debeValidarHorasSegunRolEnvio(
  registraHorasNoLectivas: boolean | null,
  envioCoordinadorADocente: boolean
): boolean {
  if (registraHorasNoLectivas === null) {
    return true;
  }

  // Si requiere no lectivas valida el docente al enviar a coordinacion.
  // Si no requiere no lectivas valida coordinacion al enviar a docente.
  return registraHorasNoLectivas ? !envioCoordinadorADocente : envioCoordinadorADocente;
}

export function validarHorasPlanDocentePorVinculacion(
  planDocente: any,
  codigoAbreviacionOVinculacionNombre?: string | null
): ValidacionHorasPlanDocente {
  const codigoAbreviacion = codigoAbreviacionOVinculacionNombre?.trim()
    ? codigoAbreviacionOVinculacionNombre.trim()
    : obtenerCodigoAbreviacionVinculacion(planDocente);
  const totalHoras = obtenerTotalHorasPlanDocente(planDocente);
  const restriccion = obtenerRestriccionHorasVinculacion(codigoAbreviacion);

  return {
    codigoAbreviacion,
    totalHoras,
    horasMinimas: restriccion?.horasMinimas ?? null,
    horasMaximas: restriccion?.horasMaximas ?? null,
    registraHorasNoLectivas: restriccion?.registraHorasNoLectivas ?? null,
    estaEnRango: restriccion ? validarHorasEnRango(totalHoras, restriccion) : null,
    horasRequeridas: restriccion?.horasMaximas ?? null,
  };
}

export function actualizarRestriccionesHoras(): void {
  RESTRICCIONES_HORAS_POR_VINCULACION["DCTC"].horasMinimas =
    obtenerValorNumericoDesdeParametro("HMINDCTC");
  RESTRICCIONES_HORAS_POR_VINCULACION["DCTC"].horasMaximas =
    obtenerValorNumericoDesdeParametro("HMAXDCTC");

  RESTRICCIONES_HORAS_POR_VINCULACION["TCO"].horasMinimas =
    obtenerValorNumericoDesdeParametro("HMINTCO");
  RESTRICCIONES_HORAS_POR_VINCULACION["TCO"].horasMaximas =
    obtenerValorNumericoDesdeParametro("HMAXTCO");

  RESTRICCIONES_HORAS_POR_VINCULACION["MTO"].horasMinimas =
    obtenerValorNumericoDesdeParametro("HMINMTO");
  RESTRICCIONES_HORAS_POR_VINCULACION["MTO"].horasMaximas =
    obtenerValorNumericoDesdeParametro("HMAXMTO");

  RESTRICCIONES_HORAS_POR_VINCULACION["HCH"].horasMinimas = null;
  RESTRICCIONES_HORAS_POR_VINCULACION["HCH"].horasMaximas =
    obtenerValorNumericoDesdeParametro("HMAXHC");

  RESTRICCIONES_HORAS_POR_VINCULACION["DCMT"].horasMinimas =
    obtenerValorNumericoDesdeParametro("HMINDCMT");
  RESTRICCIONES_HORAS_POR_VINCULACION["DCMT"].horasMaximas =
    obtenerValorNumericoDesdeParametro("HMAXDCMTO");
}