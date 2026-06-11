import { ChangeDetectorRef, Component, Inject, OnInit } from "@angular/core";
import { TranslateService } from "@ngx-translate/core";
import { PopUpManager } from "../../managers/popUpManager";
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogConfig,
  MatDialogRef,
} from "@angular/material/dialog";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import {
  BehaviorSubject,
  combineLatest,
  Subject,
  of,
  Subscription,
} from "rxjs";
import { firstValueFrom } from "rxjs/internal/firstValueFrom";
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  startWith,
  catchError,
} from "rxjs/operators";
import { ParametrosService } from "../../services/parametros.service";
import { SgaPlanTrabajoDocenteMidService } from "../../services/sga-plan-trabajo-docente-mid.service";
import { PlanTrabajoDocenteService } from "src/app/services/plan-trabajo-docente.service";
import { TercerosService } from "src/app/services/terceros.service";
import { Periodo } from "src/app/models/parametros/periodo";
import { RespFormat } from "src/app/models/response-format";
import { checkContent, checkResponse } from "src/app/utils/verify-response";
import { EspaciosAcademicos } from "src/app/models/espacios-academicos/espacios-academicos";
import { MODALS } from "src/app/models/diccionario";
import { DialogoCrearEspacioGrupoComponent } from "../dialogo-crear-espacio-grupo/dialogo-crear-espacio-grupo.component";
import { UserService } from "src/app/services/user.service";
import { ROLES } from "src/app/models/diccionario";
import { validarHorasPlanDocentePorVinculacion } from "src/app/utils/ptd-hours";

interface HorarioEspacioInfo {
  dia: string;
  franja: string;
  horas: string;
}

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

@Component({
    selector: "dialogo-preasignacion",
    templateUrl: "./dialogo-preasignacion.component.html",
    styleUrls: ["./dialogo-preasignacion.component.scss"],
    standalone: false
})
export class DialogoPreAsignacionPtdComponent implements OnInit {
  modificando: boolean = true;
  preasignacionForm: FormGroup;
  private proyectoCurricularId: number | null = null;
  roles: string[] = [];

  searchTerm$ = new Subject<any>();
  opcionesDocente: any[] = [];
  filteredDocentes: BehaviorSubject<any[]> = new BehaviorSubject<any[]>([]);
  docente: any;
  proyectosCoordinador: any[] = [];

  espaciosRaw: any[] = [];
  opcionesEspaciosAcademicos: EspaciosAcademicos[] = [];
  opcionesProyectos: any[] = [];
  opcionesGrupos: any[] = [];
  opcionesGruposTodas: any[] = [];
  periodos: Periodo[] = [];
  periodo: Periodo = new Periodo({});
  documento_docente: any;
  espacio_academico: any;
  grupo: any;
  codigoEventoPTD: string = '';
  calendarEventosPTD: any[] = [];
  calendarEventoSeleccionado: any = null;
  enRangoCalendario: boolean = false;
  horariosEspacioInfo: HorarioEspacioInfo[] = [];
  totalHorasHorarioEspacio: string = "0";
  cargandoHorarioEspacio: boolean = false;
  private resumenHorarioRequestId = 0;
  private readonly codigosVinculacionPermitidos = ["DCTC", "DCMT", "TCO", "MTO", "HCH"];

  tipoVinculacion: Array<{ id: number; nombre: string; codigo_abreviacion: string }> = [];

  tipoVinculacionFiltered: any[] = [];

  constructor(
    public dialogRef: MatDialogRef<DialogoPreAsignacionPtdComponent>,
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private planTrabajoDocenteService: PlanTrabajoDocenteService,
    private sgaPlanTrabajoDocenteMidService: SgaPlanTrabajoDocenteMidService,
    private parametrosService: ParametrosService,
    private tercerosService: TercerosService,
    private userService: UserService,
    private builder: FormBuilder,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    @Inject(MAT_DIALOG_DATA) private data: any
  ) {
    this.preasignacionForm = this.builder.group({});
  }

  cargarEventoPTD(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sgaPlanTrabajoDocenteMidService.get("calendario/eventos").subscribe({
        next: (resp: any) => {
          if (checkContent(resp)) {
            const eventos = Array.isArray(resp.Data) ? resp.Data : [];
            const evento = eventos.find((e: any) => e.Descripcion === "PLANES DE TRABAJO DOCENTES");
            if (evento) {
              this.codigoEventoPTD = evento.CodigoEvento;
              this.cargarCalendarioEventos().then(eventos => {
                this.calendarEventosPTD = eventos;
                this.verificarRangoFechas();
                resolve();
              }).catch(err => {
                console.warn(err);
                reject(err);
              });
            } else {
              resolve();
            }
          } else {
            resolve();
          }
        },
        error: (err: any) => {
          console.warn("Error obteniendo calendario/eventos:", err);
          reject(err);
        }
      });
    });
  }

  cargarCalendarioEventos(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const documento = this.obtenerDocumentoCoordinador();
      if (!documento || !this.codigoEventoPTD) {
        reject(new Error('No se pudo obtener documento o código de evento'));
        return;
      }
      this.sgaPlanTrabajoDocenteMidService.get(
        `calendario/calendario_eventos?documento=${documento}&codigo_evento=${this.codigoEventoPTD}`
      ).subscribe({
        next: (calResp: any) => {
          const data = calResp?.Data ?? calResp ?? [];
          resolve(Array.isArray(data) ? data : [data]);
        },
        error: (err: any) => {
          console.warn("Error obteniendo calendario/calendario_eventos:", err);
          reject(err);
        }
      });
    });
  }

  verificarRangoFechas() {
    this.enRangoCalendario = false;
    this.calendarEventoSeleccionado = null;
    if (!this.periodo || !this.calendarEventosPTD || this.calendarEventosPTD.length === 0) {
      return;
    }
    const eventoMatch = this.calendarEventosPTD.find((evento: any) =>
      String(evento.Year) === String(this.periodo.Year) &&
      String(evento.Ciclo) === String(this.periodo.Ciclo)
    );
    if (eventoMatch) {
      this.calendarEventoSeleccionado = eventoMatch;
      const ahora = new Date();
      const fechaInicio = new Date(eventoMatch.FechaInicio);
      const fechaFin = new Date(eventoMatch.FechaFin);
      this.enRangoCalendario = ahora >= fechaInicio && ahora <= fechaFin;
      console.log('--- Dialogo Preasignacion: Verificar Rango Fechas ---');
      console.log('Fecha actual:', ahora);
      console.log('Fecha Inicio Evento:', fechaInicio);
      console.log('Fecha Fin Evento:', fechaFin);
      console.log('¿Está en rango?:', this.enRangoCalendario);
    }
  }

  ngOnInit() {
    this.userService.getUserRoles().then(roles => {
      this.roles = roles;
    });
    this.cargarTiposVinculacion();
    this.cargarEventoPTD().then(() => {
      if (this.calendarEventosPTD && this.calendarEventosPTD.length > 0) {
        this.proyectosCoordinador = this.calendarEventosPTD.map((e: any) => ({
          nombre_carrera: e.NombreProyecto,
          codigo_carrera: e.CodigoProyecto
        }));
      } else {
        this.proyectosCoordinador = [];
      }
    });
    if (this.data.docente == undefined) {
      this.modificando = false;
      this.data = {
        tipo_vinculacion_id: null,
        docente: null,
        codigo: null,
        espacio_academico: null,
        grupo: null,
        proyecto: null,
        nivel: null,
        periodo_id: null,
        doc_docente: null,
      };
      this.preasignacionForm = this.builder.group({
        tipo_vinculacion: [this.data.tipo_vinculacion_id, Validators.required],
        docente: [this.data.docente, Validators.required],
        codigo: [this.data.codigo, Validators.required],
        espacio_academico: [this.data.espacio_academico, Validators.required],
        grupo: [this.data.grupo, Validators.required],
        proyecto: [this.data.proyecto, Validators.required],
        nivel: [this.data.nivel, Validators.required],
        periodo: [this.data.periodo_id, Validators.required],
        doc_docente: [this.data.doc_docente, Validators.required],
      });
    } else {
      this.preasignacionForm = this.builder.group({
        tipo_vinculacion: [this.data.tipo_vinculacion_id, Validators.required],
        docente: [this.data.docente.toLocaleLowerCase(), Validators.required],
        codigo: [this.data.codigo, Validators.required],
        espacio_academico: [this.data.espacio_academico, Validators.required],
        grupo: [this.data.grupo, Validators.required],
        proyecto: [this.data.proyecto, Validators.required],
        nivel: [this.data.nivel, Validators.required],
        periodo: [this.data.periodo_id, Validators.required],
        doc_docente: [this.documento_docente, Validators.required],
      });
    }

    this.preasignacionForm.get("docente")?.disable();
    this.preasignacionForm.get("codigo")?.disable();
    this.preasignacionForm.get("espacio_academico")?.disable();
    this.preasignacionForm.get("grupo")?.disable();
    this.preasignacionForm.get("proyecto")?.disable();
    this.preasignacionForm.get("nivel")?.disable();
    this.preasignacionForm.get("doc_docente")?.disable();
    this.preasignacionForm.get("tipo_vinculacion")?.disable();

    this.preasignacionForm
      .get("espacio_academico")
      ?.valueChanges.subscribe(() => {
        this.reiniciarSeleccionGrupo();
        this.limpiarResumenHorarioEspacio();
      });

    this.preasignacionForm
      .get("grupo")
      ?.valueChanges.subscribe(() => {
        this.actualizarResumenHorarioEspacio();
      });

    this.preasignacionForm
      .get("docente")
      ?.valueChanges.pipe(
        startWith(""),
        map((value) => {
          if (value === "") {
            this.filteredDocentes.next([]);
          }
          return value;
        })
      )
      .subscribe();

    let periodoSubscription: Subscription | undefined;

    const subscribeToPeriodoChanges = () => {
      periodoSubscription = this.preasignacionForm
        .get("periodo")
        ?.valueChanges.subscribe((periodo) => {
          if (periodo) {
            if (periodo.Activo) {
              this.periodo = periodo;
              this.verificarRangoFechas();
              if (!this.enRangoCalendario) {
                this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
                return;
              }
              this.preasignacionForm.get("espacio_academico")?.setValue(null);
              this.preasignacionForm.get("codigo")?.setValue(null);
              this.opcionesEspaciosAcademicos = [];
              this.cargarEspaciosAcademicos(periodo)
                .then((espaciosAcademicos) => {
                  this.opcionesEspaciosAcademicos = espaciosAcademicos;
                })
                .catch(() => {
                  this.opcionesEspaciosAcademicos = [];
                  this.popUpManager.showErrorToast(
                    this.translate.instant("ERROR.sin_espacios_academicos")
                  );
                });
              this.preasignacionForm.get("docente")?.enable();
              this.preasignacionForm.get("doc_docente")?.enable();
            } else {
              this.popUpManager.showErrorToast(
                this.translate.instant("pdt.perido_inactivo")
              );
            }
          } else {
            if (periodoSubscription) {
              periodoSubscription.unsubscribe();
            }
            this.preasignacionForm
              .get("periodo")
              ?.setValue(null, { emitEvent: false });
            this.preasignacionForm.get("docente")?.disable();
            this.preasignacionForm.get("doc_docente")?.disable();
            this.cdr.detectChanges();
            subscribeToPeriodoChanges(); // Resubscribe después de cambiar el valor
          }
        });
    };

    // Inicializa la suscripción
    subscribeToPeriodoChanges();

    this.cargarPeriodo()
      .then((periodos) => {
        this.periodos = periodos.filter((periodo) => periodo.Activo === true);
        if (this.modificando) {
          this.loadPreasignacion();
        }
      })
      .catch((error) => {
        this.popUpManager.showErrorToast(
          this.translate.instant("ERROR.sin_periodos")
        );
        this.periodos = [];
      });

    this.opcionesDocente = [];
  }

  private cargarTiposVinculacion() {
    this.parametrosService
      .get(
        "parametro?query=TipoParametroId__CodigoAbreviacion:TV&fields=Id,Nombre,CodigoAbreviacion&limit=-1"
      )
      .subscribe({
        next: (resp: RespFormat) => {
          const data = Array.isArray(resp?.Data) ? resp.Data : [];
          const vinculaciones = data
            .map((item: any) => ({
              id: Number(item?.Id),
              nombre: String(item?.Nombre || "").trim(),
              codigo_abreviacion: String(item?.CodigoAbreviacion || "").trim().toUpperCase(),
            }))
            .filter((item: any) =>
              !!item.codigo_abreviacion &&
              this.codigosVinculacionPermitidos.includes(item.codigo_abreviacion)
            );

          if (vinculaciones.length > 0) {
            this.tipoVinculacion = vinculaciones;
            this.tipoVinculacionFiltered = this.docente
              ? this.tipoVinculacion.filter((vinculacion) =>
                  this.docente?.Vinculaciones?.some(
                    (vinculacionDocente: number) => vinculacionDocente == vinculacion.id
                  )
                )
              : [];
          }
        },
        error: (error: any) => {
          console.warn("No fue posible cargar dinámicamente los tipos de vinculación", error);
        },
      });
  }

  event2text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private _filterDocente(value: any): any[] {
    if (typeof value !== "string") {
      return this.opcionesDocente;
    }

    const filterValue = value.toLowerCase();
    return this.opcionesDocente.filter((docente) =>
      docente.Nombre.toLowerCase().includes(filterValue)
    );
  }

  ngAfterViewInit() {
    this.searchTerm$
      .pipe(
        debounceTime(700),
        distinctUntilChanged(),
        filter((data) => data.text.length > 0),
        switchMap(({ text, field }) =>
          this.buscarNombreDocentes(text, field).pipe(
            catchError((error) => {
              console.error("Error during search", error);
              return of({ queryOptions: { Data: [] } }); // return an empty array or handle error as needed
            })
          )
        )
      )
      .subscribe((response: any) => {
        if (
          response.queryOptions &&
          Array.isArray(response.queryOptions.Data)
        ) {
          this.opcionesDocente = response.queryOptions.Data.filter(
            (value: any, index: any, array: any) =>
              index == array.findIndex((item: any) => item.Id == value.Id)
          );
          const filtered = this._filterDocente(
            this.preasignacionForm.get("docente")?.value || ""
          );
          this.filteredDocentes.next(filtered);
        } else {
          this.opcionesDocente = [];
          this.filteredDocentes.next([]);
        }
        this.cdr.detectChanges(); // Fuerza la detección de cambios
      });
  }

  enviarPreasignacion() {
    if (this.preasignacionForm.valid) {
      let request = {
        docente_id: String(this.docente.Id),
        tipo_vinculacion_id: String(
          this.preasignacionForm.get("tipo_vinculacion")?.value
        ),
        espacio_academico_id: this.grupo.Id,
        periodo_id: String(this.preasignacionForm.get("periodo")?.value.Id),
        aprobacion_docente: false,
        aprobacion_proyecto: false,
        proyecto_academico_id: String(this.preasignacionForm.get("espacio_academico")?.value.proyecto_academico_id),
        proyecto_academico_nombre: String(this.preasignacionForm.get("proyecto")?.value),
        activo: true,
      };

      this.validarHorasAntesDeGuardar().then((puedeGuardar) => {
        if (!puedeGuardar) {
          return;
        }

        const esp_acad_padre =
          this.preasignacionForm.get("espacio_academico")?.value;
        if (
          esp_acad_padre.espacio_modular ? esp_acad_padre.espacio_modular : false
        ) {
          this.savePreasign(request);
        } else {
          // ? no modular -> verificar que no exista preasignacion con mismo espacio y periodo
          this.planTrabajoDocenteService
            .get(
              `pre_asignacion?query=activo:true,espacio_academico_id:${this.grupo.Id},periodo_id:${this.periodo.Id}`
            )
            .subscribe({
              next: (resp) => {
                const dataResp = Array.isArray(resp?.Data) ? resp.Data : [];
                // En edición se excluye el registro actual para permitir actualizar sin falso duplicado.
                const duplicados = this.modificando
                  ? dataResp.filter((item: any) => item?._id !== this.data.id)
                  : dataResp;

                if (duplicados.length == 0) {
                  // ? continue presasignacion si cero para el grupo en particular
                  this.savePreasign(request);
                } else {
                  this.popUpManager.showPopUpGeneric(
                    this.translate.instant("ptd.seleccion_docente"),
                    this.translate.instant("ptd.no_valid_pre_asignacion"),
                    MODALS.WARNING,
                    false
                  );
                }
              },
              error: (err) => {
                this.popUpManager.showPopUpGeneric(
                  this.translate.instant("ERROR.titulo_generico"),
                  this.translate.instant("ERROR.fallo_informacion_en") +
                  ": <b>pre_asignacion</b>.<br><br>" +
                  this.translate.instant("ERROR.persiste_error_comunique_OAS"),
                  MODALS.ERROR,
                  false
                );
              },
            });
        }
      });
    } else {
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.alerta_campos_preasignacion")
      );
    }
  }

  private async validarHorasAntesDeGuardar(): Promise<boolean> {
    const docenteId = String(this.docente?.Id || "").trim();
    const periodoId = String(this.preasignacionForm.get("periodo")?.value?.Id || "").trim();
    const vinculacionId = String(this.preasignacionForm.get("tipo_vinculacion")?.value || "").trim();
    const vinculacionSeleccionada = this.tipoVinculacion.find(
      (vinculacion) => String(vinculacion.id) === vinculacionId
    );
    const codigoAbreviacion = String(vinculacionSeleccionada?.codigo_abreviacion || "").trim();

    if (!docenteId || !periodoId || !vinculacionId) {
      return true;
    }

    try {
      const planResp: any = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.get(
          `plan?docente=${docenteId}&vigencia=${periodoId}&vinculacion=${vinculacionId}`
        )
      );

      const planToValidate = planResp?.Data;
      if (!planToValidate) {
        return true;
      }

      const validacionHoras = validarHorasPlanDocentePorVinculacion(
        planToValidate,
        codigoAbreviacion
      );
      if (!validacionHoras.codigoAbreviacion || validacionHoras.horasMaximas === null) {
        this.popUpManager.showErrorAlert(
          this.translate.instant("ptd.error_validacion_horas_tipo_vinculacion")
        );
        return false;
      }

      const horasNuevaPreasignacion = await this.obtenerHorasPreasignacionFormulario();
      const horasPreviasPreasignacion = this.modificando
        ? this.obtenerHorasPreasignacionEnPlan(planToValidate, this.data?.espacio_academico_id)
        : 0;

      const totalHorasConNuevaPreasignacion = this.modificando
        ? validacionHoras.totalHoras - horasPreviasPreasignacion + horasNuevaPreasignacion
        : validacionHoras.totalHoras + horasNuevaPreasignacion;

      if (totalHorasConNuevaPreasignacion > validacionHoras.horasMaximas) {
        this.popUpManager.showErrorAlert(
          this.translate.instant("ptd.error_validacion_horas_total_plan", {
            horasRequeridas: validacionHoras.horasMaximas,
            totalHoras: totalHorasConNuevaPreasignacion,
          })
        );
        return false;
      }

      return true;
    } catch (error: any) {
      if (error?.status === 404) {
        return true;
      }

      console.warn("No fue posible validar las horas del docente antes de guardar la preasignación", error);
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.error_validacion_horas_preasignacion")
      );
      return false;
    }
  }

  private obtenerHorasPreasignacionEnPlan(planDocente: any, espacioAcademicoId: any): number {
    const idEspacio = String(espacioAcademicoId || "").trim();
    if (!idEspacio) {
      return 0;
    }

    const seleccion = Number(planDocente?.seleccion || 0);
    const cargaItems = Array.isArray(planDocente?.carga?.[seleccion])
      ? planDocente.carga[seleccion]
      : Array.isArray(planDocente?.carga?.[0])
        ? planDocente.carga[0]
        : [];

    return cargaItems.reduce((acumulado: number, item: any) => {
      const idCarga = String(item?.espacio_academico_id || item?.id_espacio_academico || "").trim();
      if (idCarga !== idEspacio) {
        return acumulado;
      }

      const horas = Number(item?.horario?.horas);
      return acumulado + (Number.isNaN(horas) ? 0 : horas);
    }, 0);
  }

  private async obtenerHorasPreasignacionFormulario(): Promise<number> {
    const colocaciones = await this.obtenerColocacionesEspacioFormulario();
    return this.calcularHorasColocaciones(colocaciones);
  }

  private async actualizarResumenHorarioEspacio(): Promise<void> {
    const espacioSeleccionado = this.preasignacionForm.get("espacio_academico")?.value;
    const grupoSeleccionado = this.preasignacionForm.get("grupo")?.value;
    const requestId = ++this.resumenHorarioRequestId;

    if (!espacioSeleccionado || !grupoSeleccionado) {
      this.limpiarResumenHorarioEspacio();
      return;
    }

    this.cargandoHorarioEspacio = true;

    try {
      const colocaciones = await this.obtenerColocacionesEspacioFormulario();
      if (requestId !== this.resumenHorarioRequestId) {
        return;
      }

      if (!colocaciones.length) {
        this.limpiarResumenHorarioEspacio();
        return;
      }

      this.horariosEspacioInfo = this.mapearHorariosEspacio(colocaciones);
      this.totalHorasHorarioEspacio = this.formatearHoras(
        this.calcularHorasColocaciones(colocaciones)
      );
    } catch {
      if (requestId === this.resumenHorarioRequestId) {
        this.limpiarResumenHorarioEspacio();
      }
    } finally {
      if (requestId === this.resumenHorarioRequestId) {
        this.cargandoHorarioEspacio = false;
      }
    }
  }

  private limpiarResumenHorarioEspacio(): void {
    this.resumenHorarioRequestId++;
    this.horariosEspacioInfo = [];
    this.totalHorasHorarioEspacio = "0";
    this.cargandoHorarioEspacio = false;
  }

  get mostrarHorarioEspacioInfo(): boolean {
    const espacioSeleccionado = this.preasignacionForm.get("espacio_academico")?.value;
    const grupoSeleccionado = this.preasignacionForm.get("grupo")?.value;
    return !!espacioSeleccionado && !!grupoSeleccionado && (
      this.cargandoHorarioEspacio || this.horariosEspacioInfo.length > 0
    );
  }

  private reiniciarSeleccionGrupo(): void {
    this.grupo = null;
    this.preasignacionForm.get("grupo")?.setValue(null, { emitEvent: false });
    this.preasignacionForm.get("proyecto")?.setValue(null, { emitEvent: false });
    this.preasignacionForm.get("nivel")?.setValue(null, { emitEvent: false });
  }

  private mapearHorariosEspacio(colocaciones: any[]): HorarioEspacioInfo[] {
    return colocaciones
      .map((colocacion: any) => {
        const horario =
          colocacion?.ResumenColocacionEspacioFisico?.colocacion ??
          colocacion?.ColocacionEspacioAcademico ??
          {};

        const finalPosition =
          horario?.finalPosition || horario?.dragPosition || horario?.prevPosition || {};
        const x = Number(finalPosition?.x);
        const diaIndex = Number.isNaN(x) ? -1 : Math.round(x / 110);
        const dia = DIAS_SEMANA[diaIndex] || this.translate.instant("ptd.dia_no_disponible");
        const franja = String(horario?.horaFormato || "").trim() ||
          this.translate.instant("ptd.franja_no_disponible");
        const horas = this.formatearHoras(Number(horario?.horas || 0));

        return {
          dia,
          franja,
          horas,
          diaIndex,
        };
      })
      .sort((actual: any, siguiente: any) => {
        if (actual.diaIndex !== siguiente.diaIndex) {
          return actual.diaIndex - siguiente.diaIndex;
        }
        return String(actual.franja).localeCompare(String(siguiente.franja));
      })
      .map(({ dia, franja, horas }) => ({ dia, franja, horas }));
  }

  private formatearHoras(horas: number): string {
    return Number.isInteger(horas) ? String(horas) : String(Number(horas.toFixed(2)));
  }

  private calcularHorasColocaciones(colocaciones: any[]): number {
    return colocaciones.reduce((acumulado: number, colocacion: any) => {
      const horas = Number(
        colocacion?.ResumenColocacionEspacioFisico?.colocacion?.horas ??
        colocacion?.ColocacionEspacioAcademico?.horas ??
        0
      );
      return acumulado + (Number.isNaN(horas) ? 0 : horas);
    }, 0);
  }

  private async obtenerColocacionesEspacioFormulario(): Promise<any[]> {
    const periodoSeleccionado = this.preasignacionForm.get("periodo")?.value as Periodo;
    const espacioSeleccionado = this.preasignacionForm.get("espacio_academico")?.value;
    const grupoSeleccionado = this.preasignacionForm.get("grupo")?.value;

    const partesPeriodo = this.obtenerPartesPeriodo(periodoSeleccionado);
    const codigoEspacio = String(espacioSeleccionado?.codigo || "").trim();
    const grupo = String(
      grupoSeleccionado?.grupo ??
      grupoSeleccionado?.Grupo ??
      grupoSeleccionado?.grupo_id ??
      grupoSeleccionado?.Id ??
      ""
    ).trim();

    if (!partesPeriodo || !codigoEspacio || !grupo) {
      throw new Error("No fue posible resolver datos para validar horas de la nueva preasignación");
    }

    const horariosResp: any = await firstValueFrom(
      this.sgaPlanTrabajoDocenteMidService.get(
        `espacio-academico/informacion-horarios/${partesPeriodo.anio}/${partesPeriodo.periodo}/${codigoEspacio}/${grupo}`
      )
    );

    return Array.isArray(horariosResp?.Data) ? horariosResp.Data : [];
  }

  savePreasign(request: any) {
    if (this.modificando) {
      this.planTrabajoDocenteService
        .put("pre_asignacion/" + this.data.id, request)
        .subscribe({
          next: (response: any) => {
            this.popUpManager.showSuccessAlert(
              this.translate.instant("ptd.preasignacion_actualizada")
            );
            this.dialogRef.close(true);
          },
          error: (error: any) => {
            this.popUpManager.showErrorAlert(
              this.translate.instant("ptd.error_actualizar_preasignacion")
            );
          },
        });
    } else {
      this.planTrabajoDocenteService.post("pre_asignacion", request).subscribe({
        next: (response: any) => {
          this.popUpManager.showSuccessAlert(
            this.translate.instant("ptd.preasignacion_creada")
          );
          this.dialogRef.close(true);
        },
        error: (error: any) => {
          this.popUpManager.showErrorAlert(
            this.translate.instant("ptd.error_crear_preasignacion")
          );
        },
      });
    }
  }

  cancelar() {
    this.dialogRef.close(false);
  }

  buscarNombreDocentes(text: string, field: any) {
    let query = `docente/nombre?nombre=${text}`;
    const channelOptions = new BehaviorSubject<any>({ field: field });
    const options$ = channelOptions.asObservable();
    const queryOptions$ = this.sgaPlanTrabajoDocenteMidService.get(query);

    return combineLatest([options$, queryOptions$]).pipe(
      map(([options$, queryOptions$]) => ({
        options: options$,
        queryOptions: queryOptions$,
        keyToFilter: text,
      }))
    );
  }

  handlerSelectDocente(element: any) {
    this.docente = element.option.value;
    this.setDocente();
  }

  setDocente() {
    if (this.docente) {
      this.documento_docente = this.docente.Documento;
      this.preasignacionForm
        .get("doc_docente")
        ?.setValue(this.docente.Documento);
      this.preasignacionForm.get("docente")?.setValue(this.docente.Nombre);
      this.tipoVinculacionFiltered = this.tipoVinculacion.filter(
        (vinculacion) =>
          this.docente?.Vinculaciones.some(
            (vinculacion_docente: number) =>
              vinculacion_docente == vinculacion.id
          )
      );
      this.preasignacionForm.get("codigo")?.enable();
      this.preasignacionForm.get("espacio_academico")?.enable();
      this.preasignacionForm.get("tipo_vinculacion")?.enable();
    } else {
      this.preasignacionForm.get("codigo")?.disable();
      this.preasignacionForm.get("espacio_academico")?.disable();
      this.preasignacionForm.get("tipo_vinculacion")?.disable();
      this.preasignacionForm.get("docente")?.setValue(null);
      this.documento_docente = null;
      this.tipoVinculacionFiltered = [];
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.error_no_found_docente")
      );
    }
  }

  cargarPeriodo(): Promise<Periodo[]> {
    return new Promise((resolve, reject) => {
      this.parametrosService
        .get("periodo?query=CodigoAbreviacion:PA&sortby=Id&order=desc&limit=0")
        .subscribe({
          next: (resp: RespFormat) => {
            if (checkResponse(resp) && checkContent(resp.Data)) {
              resolve(resp.Data as Periodo[]);
            } else {
              reject(new Error("No se encontraron periodos"));
            }
          },
          error: (err) => {
            reject(err);
          },
        });
    });
  }

  private obtenerPartesPeriodo(
    periodoSeleccionado: Periodo
  ): { anio: string; periodo: string } | null {
    const nombrePeriodo = periodoSeleccionado?.Nombre ?? "";
    const nombrePeriodoLimpio = nombrePeriodo.trim();
    const coincidencia = nombrePeriodoLimpio.match(/(\d{4})\D+(\d{1,2})/);

    if (coincidencia) {
      return { anio: coincidencia[1], periodo: coincidencia[2] };
    }

    if (periodoSeleccionado?.Year && periodoSeleccionado?.Ciclo) {
      const ciclo = periodoSeleccionado.Ciclo.trim().toUpperCase();
      const cicloMap: { [key: string]: string } = {
        I: "1",
        II: "2",
        III: "3",
        1: "1",
        2: "2",
        3: "3",
      };

      if (cicloMap[ciclo]) {
        return {
          anio: String(periodoSeleccionado.Year),
          periodo: cicloMap[ciclo],
        };
      }
    }

    return null;
  }

  private obtenerDocumentoCoordinador(): string | null {
    try {
      const userEncoded = window.localStorage.getItem("user");
      if (!userEncoded) {
        return null;
      }

      const decoded = JSON.parse(atob(userEncoded));
      const posiblesDocumentos: any[] = [
        decoded?.user?.documento,
        decoded?.userService?.documento,
        decoded?.user?.documento_compuesto,
        decoded?.userService?.documento_compuesto,
      ];

      for (const valor of posiblesDocumentos) {
        const documento = String(valor ?? "").trim();
        if (documento) {
          return documento;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private normalizarEspacioAcademico(espacio: any): EspaciosAcademicos {
    const id =
      espacio?._id ??
      espacio?.id ??
      espacio?.espacio_academico_id ??
      espacio?.Id ??
      "";

    return {
      ...new EspaciosAcademicos({
        _id: String(id),
        codigo: String(
          espacio?.codigo ?? espacio?.codigo_espacio ?? espacio?.cod_espacio ?? ""
        ),
        nombre: String(
          espacio?.nombre ??
          espacio?.nombre_espacio ??
          espacio?.espacio_academico ??
          ""
        ),
        proyecto_academico_id: Number(
          espacio?.proyecto_academico_id ??
          espacio?.codigo_carrera ??
          espacio?.proyecto_id ??
          this.proyectoCurricularId ??
          0
        ),
        activo: true,
      }),
      espacio_modular:
        espacio?.espacio_modular !== undefined
          ? espacio.espacio_modular
          : false,
    } as EspaciosAcademicos;
  }

  cargarEspaciosAcademicos(
    periodoSeleccionado: Periodo
  ): Promise<EspaciosAcademicos[]> {
    return new Promise((resolve, reject) => {
      const partesPeriodo = this.obtenerPartesPeriodo(periodoSeleccionado);
      if (!partesPeriodo) {
        reject(new Error("No fue posible obtener anio y periodo"));
        return;
      }

      const documentoCoordinador = this.obtenerDocumentoCoordinador();
      if (!documentoCoordinador) {
        reject(new Error("No fue posible obtener el documento del coordinador"));
        return;
      }

      const endpoint =
        `espacio-academico/proyecto-periodo?anio=${partesPeriodo.anio}` +
        `&periodo=${partesPeriodo.periodo}&documento_coordinador=${documentoCoordinador}`;

      this.sgaPlanTrabajoDocenteMidService
        .get(endpoint)
        .subscribe({
          next: (resp: any) => {
            const dataResp = Array.isArray(resp?.Data)
              ? resp.Data
              : Array.isArray(resp)
                ? resp
                : [];

            this.espaciosRaw = dataResp;

            const espacios = dataResp
              .map((espacio: any) => this.normalizarEspacioAcademico(espacio))
              .filter((espacio: EspaciosAcademicos) => espacio._id);

            const proyectoDesdeServicio = Number(dataResp?.[0]?.codigo_carrera);
            if (!Number.isNaN(proyectoDesdeServicio) && proyectoDesdeServicio > 0) {
              this.proyectoCurricularId = proyectoDesdeServicio;
            }

            if (espacios.length > 0) {
              resolve(espacios);
            } else {
              reject(new Error("No se encontraron Espacios Academicos"));
            }
          },
          error: (err) => {
            reject(err);
          },
        });
    });
  }

  buscarDocenteDocumento(event: any) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (this.preasignacionForm.get("doc_docente")?.value != null) {
      this.sgaPlanTrabajoDocenteMidService
        .get(
          `docente/documento?documento=${this.preasignacionForm.get("doc_docente")?.value
          }`
        )
        .subscribe({
          next: (resp: RespFormat) => {
            if (checkResponse(resp) && checkContent(resp.Data)) {
              this.docente = resp.Data[0];
            } else {
              this.docente = null;
            }
            this.setDocente();
          },
          error: (err) => {
            this.preasignacionForm.get("codigo")?.disable();
            this.preasignacionForm.get("espacio_academico")?.disable();
            this.preasignacionForm.get("tipo_vinculacion")?.disable();
            this.preasignacionForm.get("docente")?.setValue(null);
            this.docente = null;
            this.documento_docente = null;
            this.tipoVinculacionFiltered = [];
            this.popUpManager.showErrorAlert(
              this.translate.instant("ptd.error_no_found_docente")
            );
          },
        });
    } else {
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.error_doc_docente")
      );
    }
  }

  buscarEspacioAcademico(event: any) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (this.preasignacionForm.get("codigo")?.value != null) {
      const codigoBuscado = String(
        this.preasignacionForm.get("codigo")?.value
      ).trim();
      const espacioEncontrado = this.opcionesEspaciosAcademicos.find(
        (espacio) => String(espacio.codigo).trim() === codigoBuscado
      );

      if (espacioEncontrado) {
        this.preasignacionForm
          .get("espacio_academico")
          ?.setValue(espacioEncontrado);
        this.preasignacionForm.get("grupo")?.enable();
        this.preasignacionForm.get("proyecto")?.enable();
        this.preasignacionForm.get("nivel")?.enable();
        this.loadProyectos();
      } else {
        this.preasignacionForm.get("espacio_academico")?.setValue(null);
        this.preasignacionForm.get("grupo")?.disable();
        this.preasignacionForm.get("proyecto")?.disable();
        this.preasignacionForm.get("nivel")?.disable();
        this.popUpManager.showErrorAlert(
          this.translate.instant("ptd.error_no_found_espacio_academico")
        );
      }
    } else {
      this.preasignacionForm.get("espacio_academico")?.setValue(null);
      this.preasignacionForm.get("grupo")?.disable();
      this.preasignacionForm.get("proyecto")?.disable();
      this.preasignacionForm.get("nivel")?.disable();
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.error_codigo")
      );
    }
  }

  loadProyectos(): Promise<any> {
    this.preasignacionForm.get("proyecto")?.setValue(null);
    this.opcionesGrupos = [];
    this.opcionesProyectos = [];
    this.limpiarResumenHorarioEspacio();

    return new Promise((resolve, reject) => {
      // Cláusula de guarda: Si no hay espacio académico, limpiamos y rechazamos de inmediato
      if (this.preasignacionForm.get("espacio_academico")?.value == null) {
        this.limpiarFormularioPorFaltaDeEspacio();
        return reject(this.opcionesGrupos);
      }

      this.espacio_academico = this.preasignacionForm.get("espacio_academico")?.value;
      this.configurarFormularioActivo();

      const partesPeriodo = this.obtenerPartesPeriodo(this.periodo);
      if (!partesPeriodo) {
        this.popUpManager.showErrorAlert(this.translate.instant("ptd.error_no_found_proyectos"));
        return reject(this.opcionesGrupos);
      }

      this.consultarGruposPeriodo(partesPeriodo, resolve);
    });
  }

  /**
   * Configura los campos del formulario cuando el espacio académico es válido.
   */
  private configurarFormularioActivo(): void {
    this.preasignacionForm.get("codigo")?.setValue(this.espacio_academico.codigo);
    this.preasignacionForm.get("grupo")?.enable();
    this.preasignacionForm.get("proyecto")?.enable();
    this.preasignacionForm.get("nivel")?.enable();
  }

  /**
   * Limpia y deshabilita los campos si no se ha seleccionado un espacio académico.
   */
  private limpiarFormularioPorFaltaDeEspacio(): void {
    this.preasignacionForm.get("codigo")?.setValue(null);
    this.preasignacionForm.get("grupo")?.disable();
    this.preasignacionForm.get("proyecto")?.disable();
    this.preasignacionForm.get("nivel")?.disable();
  }

  /**
   * Realiza la petición HTTP al servicio de planes de trabajo.
   */
  private consultarGruposPeriodo(partesPeriodo: any, resolve: (value: any) => void): void {
    const endpoint = `espacio-academico/grupos-periodo?anio=${partesPeriodo.anio}&periodo=${partesPeriodo.periodo}&espacio=${this.espacio_academico._id}`;
    
    this.sgaPlanTrabajoDocenteMidService.get(endpoint).subscribe({
      next: (resp: any) => {
        if (resp.Success && resp.Data != null) {
          this.opcionesGruposTodas = resp.Data;
          this.opcionesProyectos = [];
          
          this.procesarProyectosDocentes(resp.Data);
          resolve(this.opcionesGrupos);
        } else {
          this.popUpManager.showAlert("", this.translate.instant("ptd.mensaje_espacio_sin_grupos"));
        }
      }
    });
  }

  /**
   * Filtra y procesa los proyectos académicos del coordinador evitando duplicados.
   */
  private procesarProyectosDocentes(data: any[]): void {
    data.forEach((element: any) => {
      const nombreGrupo = String(element.ProyectoAcademico).trim().toUpperCase();
      
      if (this.esProyectoDelCoordinador(nombreGrupo) && !this.existeProyectoEnOpciones(nombreGrupo)) {
        this.opcionesProyectos.push(element.ProyectoAcademico);
      }
    });
  }

  private esProyectoDelCoordinador(nombreGrupo: string): boolean {
    return this.proyectosCoordinador.some(
      (proyecto) => String(proyecto.nombre_carrera).trim().toUpperCase() === nombreGrupo
    );
  }

  private existeProyectoEnOpciones(nombreGrupo: string): boolean {
    return this.opcionesProyectos.some(
      (opcion) => String(opcion).trim().toUpperCase() === nombreGrupo
    );
  }

  changeProyecto() {
    const proyectoSeleccionado = this.preasignacionForm.get("proyecto")?.value;
    if (!proyectoSeleccionado) {
      this.opcionesGrupos = this.opcionesGruposTodas;
      this.preasignacionForm.get("grupo")?.setValue(null);
      this.preasignacionForm.get("nivel")?.setValue(null);
      return;
    }
    const nombreProyecto = String(proyectoSeleccionado)
      .trim()
      .toUpperCase();
    // Filtrar solo si hay proyectos de coordinador asignados
    if (this.proyectosCoordinador.length > 0) {
      this.opcionesGrupos = this.opcionesGruposTodas.filter(
        (grupo) =>
          String(grupo.ProyectoAcademico)
            .trim()
            .toUpperCase() === nombreProyecto
      );
    } else {
      // Si no hay proyectos de coordinador, mostrar todos (usuario solo tiene rol docente)
      this.opcionesGrupos = this.opcionesGruposTodas;
    }
    this.preasignacionForm.get("grupo")?.setValue(null);
    if (this.opcionesGrupos.length > 0) {
      this.preasignacionForm
        .get("nivel")
        ?.setValue(this.opcionesGrupos[0].Nivel);
    } else {
      this.preasignacionForm.get("nivel")?.setValue(null);
    }
  }

  changeGrupo() {
    if (this.preasignacionForm.get("grupo")?.value != null) {
      this.grupo = this.preasignacionForm.get("grupo")?.value;
      this.preasignacionForm.get("nivel")?.setValue(this.grupo.Nivel);
      this.preasignacionForm
        .get("proyecto")
        ?.setValue(this.grupo.ProyectoAcademico);
    } else {
      this.preasignacionForm.get("nivel")?.setValue(null);
      this.preasignacionForm.get("proyecto")?.setValue(null);
      this.limpiarResumenHorarioEspacio();
    }
  }

  async loadPreasignacion(): Promise<void> {
    const endpoint = `datos_identificacion?query=TerceroId.Id:${this.data.docente_id},Activo:true&fields=Numero`;

    this.tercerosService.get(endpoint).subscribe({
      next: async (res: any) => {
        this.preasignacionForm.get("doc_docente")?.setValue(res[0].Numero);
        this.buscarDocenteDocumento(null);

        // 1. Buscar y validar el periodo
        const periodoSeleccionado = this.periodos.find(p => p.Id == this.data.periodo_id);
        
        if (periodoSeleccionado) {
          this.periodo = periodoSeleccionado;
          await this.procesarEspaciosYProyectos(periodoSeleccionado);
        }

        // 2. Asignar tipo de vinculación al finalizar el flujo principal
        this.preasignacionForm
          .get("tipo_vinculacion")
          ?.setValue(parseInt(this.data.tipo_vinculacion_id));
      }
    });
  }

  /**
   * Maneja de forma lineal la carga de espacios académicos y proyectos
   */
  private async procesarEspaciosYProyectos(periodo: any): Promise<void> {
    try {
      // Cargar espacios académicos
      this.opcionesEspaciosAcademicos = await this.cargarEspaciosAcademicos(periodo);
      
      this.preasignacionForm.get("periodo")?.setValue(periodo, { emitEvent: false });
      
      const espacioPadre = this.opcionesEspaciosAcademicos.find(
        (espacio) => espacio._id == this.data.espacio_academico_padre
      );
      this.preasignacionForm.get("espacio_academico")?.setValue(espacioPadre);

      // Esperar a que se carguen los proyectos
      await this.loadProyectos();
      
      // Procesar la asignación del grupo
      this.asignarGrupo();
      
    } catch (error) {
      this.opcionesEspaciosAcademicos = [];
      this.popUpManager.showErrorToast(this.translate.instant("ERROR.sin_espacios_academicos"));
    }
  }

  /**
   * Busca el grupo correspondiente y aplica las reglas de negocio/fallbacks
   */
  private asignarGrupo(): void {
    const grupoACargar = this.opcionesGruposTodas.find(
      (grupo) => grupo.Id == this.data.espacio_academico_id
    );

    if (grupoACargar) {
      this.preasignacionForm.get("proyecto")?.setValue(grupoACargar.ProyectoAcademico);
      this.changeProyecto();
      this.preasignacionForm.get("grupo")?.setValue(grupoACargar);
    } else {
      // Fallback: asignar desde el listado general si no se encuentra
      const grupoFallback = this.opcionesGruposTodas.find(
        (grupo) => grupo.Id == this.data.espacio_academico_id
      );
      this.preasignacionForm.get("grupo")?.setValue(grupoFallback);
    }

    this.changeGrupo();
  }

  get isEspacioModular(): boolean {
    const espacio = this.preasignacionForm.get("espacio_academico")?.value;
    return espacio ? espacio.espacio_modular : false;
  }

  abrirDialogoCrearEspacioGrupo(espacioAcademico: any) {
    const dialogRef = this.dialog.open(DialogoCrearEspacioGrupoComponent, {
      width: "50%",
      height: "auto",
      data: {
        espacioAcademico: espacioAcademico,
        periodo: this.preasignacionForm.get("periodo")?.value,
      },
    });

    dialogRef.afterClosed().subscribe((grupoEspacio) => {
      if (grupoEspacio && grupoEspacio.creado) {
        this.loadProyectos();
      }
    });
  }
}
