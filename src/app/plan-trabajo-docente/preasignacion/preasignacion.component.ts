import { AfterViewInit, Component, OnInit, ViewChild, ChangeDetectorRef } from "@angular/core";
import { MatPaginator } from "@angular/material/paginator";
import { MatSort } from "@angular/material/sort";
import { MatTableDataSource } from "@angular/material/table";
import { TranslateService } from "@ngx-translate/core";
import { PopUpManager } from "src/app/managers/popUpManager";
import { Periodo } from "src/app/models/parametros/periodo";
import { RespFormat } from "src/app/models/response-format";
import { ParametrosService } from "src/app/services/parametros.service";
import { UserService } from "src/app/services/user.service";
import { checkContent, checkResponse } from "src/app/utils/verify-response";
import { MODALS, ROLES } from "src/app/models/diccionario";
import { SgaPlanTrabajoDocenteMidService } from "src/app/services/sga-plan-trabajo-docente-mid.service";
import { MatDialog, MatDialogConfig } from "@angular/material/dialog";
import { DialogoPreAsignacionPtdComponent } from "src/app/dialog-components/dialogo-preasignacion/dialogo-preasignacion.component";
import { PlanTrabajoDocenteService } from "src/app/services/plan-trabajo-docente.service";
import { PermisosUtils } from "src/app/utils/role-permissions";
import { AcademicaJbpmService } from "src/app/services/academica-jbpm.service";
import { Observable } from "rxjs/internal/Observable";
import { firstValueFrom } from "rxjs/internal/firstValueFrom";
import { forkJoin } from "rxjs/internal/observable/forkJoin";

@Component({
    selector: "app-preasignacion",
    templateUrl: "./preasignacion.component.html",
    styleUrls: ["./preasignacion.component.scss"],
    standalone: false
})
export class PreasignacionComponent implements OnInit, AfterViewInit {
  roles: string[] = [];

  opcionesPermisos: string[] = [
    'aprobacion_docente',
    'nueva_preasignacion',
    'tabla_coordinador',
    'tabla_docente',
  ];
  permisos: { [key: string]: boolean } = {};
  periodos: Periodo[] = [];
  periodosFiltrados: Periodo[] = [];
  periodo: Periodo = new Periodo({});
  proyectos: any[] = [];
  proyecto: any;
  codigoEventoPTD: string = '';
  calendarEventosPTD: any[] = [];
  calendarEventoSeleccionado: any = null;
  enRangoCalendario: boolean = false;

  dataSource: MatTableDataSource<any>;
  displayedColumns_docente: string[] = [
    "espacio_academico",
    "periodo",
    "grupo",
    "proyecto",
    "nivel",
    "aprobacion_docente",
    "aprobacion_proyecto",
    "semaforo_preasignacion",
  ];
  displayedColumns_coord: string[] = [
    "docente",
    "espacio_academico",
    "periodo",
    "grupo",
    "proyecto",
    "nivel",
    "aprobacion_docente",
    "aprobacion_proyecto",
    "semaforo_preasignacion",
    "editar",
    "borrar",
  ];
  @ViewChild('paginatorDocente') paginatorDocente!: MatPaginator;
  @ViewChild('paginatorCoord') paginatorCoord!: MatPaginator;
  @ViewChild('docenteSort') docenteSort!: MatSort;
  @ViewChild('coordSort') coordSort!: MatSort;

  vistaActiva: 'docente' | 'coordinador' = 'docente';
  hasAttemptedToLoad: boolean = false;
  dialogConfig: MatDialogConfig;
  private estadoPlanAprobadoId: string | null = null;
  private estadoPlanAprobadoCargado = false;

  constructor(
    private userService: UserService,
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private parametrosService: ParametrosService,
    private planDocenteMid: SgaPlanTrabajoDocenteMidService,
    private planTrabajoDocenteService: PlanTrabajoDocenteService,
    private dialog: MatDialog,
    private permisosUtils: PermisosUtils,
    private academicaJbpmService: AcademicaJbpmService,
    private cdr: ChangeDetectorRef
  ) {
    this.dataSource = new MatTableDataSource();
    this.dialogConfig = new MatDialogConfig();
  }

  ngOnInit() {
    this.cargarEventoPTD();
    this.userService.getUserRoles().then(async (roles) => {
      this.roles = roles;
      const observables: { [key: string]: Observable<boolean> } = {};
      this.opcionesPermisos.forEach(opcion => {
        observables[opcion] =
          this.permisosUtils.tienePermiso(this.roles, opcion);
      });
      const resultados = await firstValueFrom(forkJoin(observables));
      this.permisos = resultados;
      console.log('Permisos:', this.permisos);
      
      // Inicializar vistaActiva basado en permisos
      if (!this.permisos['tabla_docente'] && this.permisos['tabla_coordinador']) {
        this.vistaActiva = 'coordinador';
      } else {
        this.vistaActiva = 'docente'; // Por defecto docente si tiene el permiso
      }
    });
    this.cargarPeriodo()
      .then((resp) => (this.periodos = resp))
      .catch((err) => {
        this.popUpManager.showErrorToast(
          this.translate.instant("GLOBAL.sin_periodo")
        );
        this.periodos = [];
      });

    this.dialogConfig.width = "65vw";
    this.dialogConfig.minWidth = "700px";
    this.dialogConfig.height = "65vh";
    this.dialogConfig.maxHeight = "615px";
    this.dialogConfig.data = {};
  }

  cargarEventoPTD() {
    this.planDocenteMid.get("calendario/eventos").subscribe({
      next: (resp: any) => {
        if (checkContent(resp)) {
          const eventos = Array.isArray(resp.Data) ? resp.Data : [];
          const evento = eventos.find((e: any) => e.Descripcion === "PLANES DE TRABAJO DOCENTES");
          if (evento) {
            this.codigoEventoPTD = evento.CodigoEvento;
            this.cargarCalendarioEventos().then(eventosCalendario => {
              this.calendarEventosPTD = eventosCalendario;
              this.resolverProyectosDesdeCalendario();
            }).catch(err => console.warn(err));
          }
        }
      },
      error: (err: any) => {
        console.warn("Error obteniendo calendario/eventos:", err);
      }
    });
  }

  cargarCalendarioEventos(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const documento = this.obtenerDocumentoCoordinador();
      if (!documento || !this.codigoEventoPTD) {
        reject(new Error('No se pudo obtener documento o código de evento'));
        return;
      }
      this.planDocenteMid.get(
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

  resolverProyectosDesdeCalendario() {
    if (!this.calendarEventosPTD || this.calendarEventosPTD.length === 0) return;
    const proyectosMap = new Map<string, any>();
    this.calendarEventosPTD.forEach((evento: any) => {
      const id = String(evento.CodigoProyecto);
      if (id && evento.NombreProyecto && !proyectosMap.has(id)) {
        proyectosMap.set(id, { Id: id, Codigo: id, Nombre: evento.NombreProyecto });
      }
    });
    this.proyectos = Array.from(proyectosMap.values());
  }

  filtrarPeriodosPorCalendario() {
    if (!this.calendarEventosPTD || this.calendarEventosPTD.length === 0) {
      this.periodosFiltrados = [];
      return;
    }
    const eventosDelProyecto = this.calendarEventosPTD.filter((e: any) =>
      String(e.CodigoProyecto) === String(this.proyecto?.Id)
    );
    const vistos = new Set<string>();
    this.periodosFiltrados = this.periodos.filter(periodo => {
      const evento = eventosDelProyecto.find((e: any) =>
        String(e.Year) === String(periodo.Year) &&
        String(e.Ciclo) === String(periodo.Ciclo)
      );
      if (evento) {
        if (vistos.has(periodo.Nombre)) return false;
        vistos.add(periodo.Nombre);

        periodo.InicioVigencia = evento.FechaInicio;
        periodo.FinVigencia = evento.FechaFin;
        const ahora = new Date();
        const fechaInicio = new Date(evento.FechaInicio);
        const fechaFin = new Date(evento.FechaFin);
        periodo.Activo = ahora >= fechaInicio && ahora <= fechaFin;
        return true;
      }
      return false;
    });
  }

  verificarRangoFechas() {
    this.enRangoCalendario = false;
    this.calendarEventoSeleccionado = null;
    if (!this.periodo || !this.proyecto || !this.calendarEventosPTD || this.calendarEventosPTD.length === 0) {
      return;
    }
    const eventoMatch = this.calendarEventosPTD.find((evento: any) =>
      String(evento.CodigoProyecto) === String(this.proyecto.Id) &&
      String(evento.Year) === String(this.periodo.Year) &&
      String(evento.Ciclo) === String(this.periodo.Ciclo)
    );
    if (eventoMatch) {
      this.calendarEventoSeleccionado = eventoMatch;
      const ahora = new Date();
      const fechaInicio = new Date(eventoMatch.FechaInicio);
      const fechaFin = new Date(eventoMatch.FechaFin);
      this.enRangoCalendario = ahora >= fechaInicio && ahora <= fechaFin;
      console.log('--- Preasignacion: Verificar Rango Fechas ---');
      console.log('Fecha actual:', ahora);
      console.log('Fecha Inicio Evento:', fechaInicio);
      console.log('Fecha Fin Evento:', fechaFin);
      console.log('¿Está en rango?:', this.enRangoCalendario);
    }
  }

  ngAfterViewInit() {
    // Paginador/sort se adjuntan dinámicamente en loadPreasignaciones()
  }

  private attachPaginatorAndSort() {
    // Usar setTimeout para permitir que Angular actualice el DOM y que los @ViewChild estén disponibles
    setTimeout(() => {
      if (this.vistaActiva === 'docente' && this.paginatorDocente && this.docenteSort) {
        this.dataSource.paginator = this.paginatorDocente;
        this.dataSource.sort = this.docenteSort;
        this.cdr.detectChanges();
        this.dataSource.paginator.firstPage();
      } else if (this.vistaActiva === 'coordinador' && this.paginatorCoord && this.coordSort) {
        this.dataSource.paginator = this.paginatorCoord;
        this.dataSource.sort = this.coordSort;
        this.cdr.detectChanges();
        this.dataSource.paginator.firstPage();
      }
    }, 100);
  }

  cambiarVista(vista: 'docente' | 'coordinador') {
    this.vistaActiva = vista;
    this.dataSource.filter = '';
    this.dataSource.data = [];
    this.hasAttemptedToLoad = false;
    this.attachPaginatorAndSort();
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

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  actualizarAprobacion(evento: any, campo: 'aprobacion_docente' | 'aprobacion_proyecto') {
    const fila = evento?.Data;
    if (!fila || !campo || !fila[campo]) {
      return;
    }

    fila[campo].value = !!evento?.value;
    if (campo === 'aprobacion_docente') {
      fila[campo].seleccionado = !!evento?.value;
    }
    this.dataSource.data = [...this.dataSource.data];
  }

  tienePreasignacionesSeleccionadas(): boolean {
    return this.dataSource.data.some((preasignacion: any) =>
      !!preasignacion?.aprobacion_docente?.seleccionado
    );
  }

  // Reseta el check de aprobacion_proyecto para otras preasignaciones del mismo proyecto
  private async resetearAprobacionProyecto(preasignacion: any): Promise<void> {
    if (!preasignacion?.codigo_proyecto_academico || !preasignacion?.periodo_id) {
      return;
    }

    // Si la preasignación no tiene aprobación docente ni aprobación proyecto,
    // no afecta el flujo de aprobación de los demás espacios: salir sin cambios.
    const tieneAprobacionDocente = this.getAprobacionValue(preasignacion?.aprobacion_docente);
    const tieneAprobacionProyecto = this.getAprobacionValue(preasignacion?.aprobacion_proyecto);
    if (!tieneAprobacionDocente && !tieneAprobacionProyecto) {
      return;
    }

    const proyectoId = preasignacion.codigo_proyecto_academico;
    const periodoId = preasignacion.periodo_id;
    
    try {
      // Obtener todas las preasignaciones del proyecto en este período
      const resp: any = await firstValueFrom(
        this.planDocenteMid.get(`preasignacion?vigencia=${periodoId}`)
      );

      const preasignaciones = Array.isArray(resp?.Data) ? resp.Data : [];
      
      // Filtrar las preasignaciones del mismo docente y proyecto que tienen aprobacion_proyecto = true
      const idsAResetear = preasignaciones
        .filter((p: any) => 
          String(p?.codigo_proyecto_academico || "").trim() === String(proyectoId).trim() &&
          String(p?.docente_id || "").trim() === String(preasignacion.docente_id || "").trim() &&
          p?.id !== preasignacion.id &&
          this.getAprobacionValue(p?.aprobacion_proyecto)
        )
        .map((p: any) => ({ Id: p?.id || p?._id }))
        .filter((p: any) => !!String(p.Id || "").trim());

      // Si hay preasignaciones a resetear, usar el endpoint /aprobar
      if (idsAResetear.length > 0) {
        try {
          const updatePayload = {
            preasignaciones: [],
            "no-preasignaciones": idsAResetear,
            docente: false
          };
          
          await firstValueFrom(
            this.planDocenteMid.put("preasignacion/aprobar", updatePayload)
          );
        } catch (error) {
          console.warn(`No se pudo resetear aprobacion_proyecto para las preasignaciones:`, error);
        }
      }

      // Actualizar dataSource local también
      this.dataSource.data.forEach((item: any) => {
        if (
          item.codigo_proyecto_academico === proyectoId &&
          String(item.docente_id || "").trim() === String(preasignacion.docente_id || "").trim() &&
          item.id !== preasignacion.id &&
          item.aprobacion_proyecto?.value
        ) {
          item.aprobacion_proyecto.value = false;
        }
      });

      // Notificar al dataSource del cambio
      this.dataSource.data = [...this.dataSource.data];
    } catch (error) {
      console.warn("Error al resetear aprobacion_proyecto:", error);
    }
  }

  // Filtra las cargas del plan docente por espacio_academico_id
  private filtrarCargasPorEspacioAcademico(cargas: any[], espacioAcademicoId: string): any[] {
    if (!Array.isArray(cargas) || !espacioAcademicoId) {
      return [];
    }
    return cargas.filter((carga: any) =>
      String(carga?.espacio_academico_id || carga?.id_espacio_academico || "").trim() === 
      String(espacioAcademicoId || "").trim()
    );
  }

  private async limpiarCargaPlanDePreasignacion(preasignacion: any): Promise<boolean> {
    if (!preasignacion?.docente_id || !preasignacion?.periodo_id || !preasignacion?.tipo_vinculacion_id || !preasignacion?.espacio_academico_id) {
      return false;
    }

    try {
      const estadosPlanResp: any = await firstValueFrom(
        this.planTrabajoDocenteService.get("estado_plan?query=activo:true&limit=0")
      );

      const estadoPlanDef = Array.isArray(estadosPlanResp?.Data)
        ? estadosPlanResp.Data.find((estado: any) => String(estado?.codigo_abreviacion || "").trim() === "DEF")?._id
        : undefined;

      if (!estadoPlanDef) {
        return false;
      }

      const planResp: any = await firstValueFrom(
        this.planDocenteMid.get(
          `plan?docente=${preasignacion.docente_id}&vigencia=${preasignacion.periodo_id}&vinculacion=${preasignacion.tipo_vinculacion_id}`
        )
      );

      const dataPlan = planResp?.Data;
      const seleccion = Number(dataPlan?.seleccion || 0);
      const planDocente = Array.isArray(dataPlan?.plan_docente)
        ? dataPlan.plan_docente[seleccion] ?? dataPlan.plan_docente[0]
        : dataPlan?.plan_docente;
      const planDocenteId = typeof planDocente === "object"
        ? planDocente?._id || planDocente?.id
        : planDocente;

      if (!planDocenteId) {
        return false;
      }

      const cargaActual = Array.isArray(dataPlan?.carga?.[seleccion])
        ? dataPlan.carga[seleccion]
        : [];

      // Filtrar cargas que pertenecen al espacio académico de la preasignación
      const cargasDelEspacio = this.filtrarCargasPorEspacioAcademico(
        cargaActual,
        preasignacion.espacio_academico_id
      );

      const idsADescartar = cargasDelEspacio
        .map((carga: any) => ({ id: carga.id }))
        .filter((carga: any) => !!String(carga.id || "").trim());

      // Solo hacer la solicitud si hay cargas a eliminar
      if (idsADescartar.length === 0) {
        return true;
      }

      const respuesta: RespFormat = await firstValueFrom(
        this.planDocenteMid.put("plan/", {
          carga_plan: [],
          plan_docente: {
            id: planDocenteId,
            resumen: JSON.stringify({}),
            estado_plan: estadoPlanDef,
          },
          descartar: idsADescartar,
        })
      );

      return checkResponse(respuesta);
    } catch (error) {
      console.warn("No fue posible limpiar la carga del plan desde preasignación", error);
      return false;
    }
  }

  private async obtenerEstadoPlanAprobadoId(): Promise<string | null> {
    if (this.estadoPlanAprobadoCargado) {
      return this.estadoPlanAprobadoId;
    }

    try {
      const estadosResp: any = await firstValueFrom(
        this.planTrabajoDocenteService.get("estado_plan?query=codigo_abreviacion:APR&limit=1")
      );

      const estadoApr = Array.isArray(estadosResp?.Data) && estadosResp.Data.length > 0
        ? estadosResp.Data[0]?._id
        : null;

      this.estadoPlanAprobadoId = estadoApr ? String(estadoApr) : null;
    } catch (error) {
      console.warn("No fue posible consultar el estado de plan aprobado", error);
      this.estadoPlanAprobadoId = null;
    }

    this.estadoPlanAprobadoCargado = true;
    return this.estadoPlanAprobadoId;
  }

  private extraerPlanDocenteId(preasignacion: any): string {
    const id = String(preasignacion?.plan_docente?._id || "").trim();
    return id || "";
  }

  private async resolverPlanDocenteId(preasignacion: any): Promise<string> {
    const idDirecto = this.extraerPlanDocenteId(preasignacion);
    if (idDirecto) {
      return idDirecto;
    }

    const docenteId = String(preasignacion?.docente_id || "").trim();
    const vigenciaId = String(preasignacion?.periodo_id || "").trim();
    const vinculacionId = String(preasignacion?.tipo_vinculacion_id || "").trim();

    if (!docenteId || !vigenciaId || !vinculacionId) {
      return "";
    }

    try {
      const planResp: any = await firstValueFrom(
        this.planDocenteMid.get(
          `plan?docente=${docenteId}&vigencia=${vigenciaId}&vinculacion=${vinculacionId}`
        )
      );

      const dataPlan = planResp?.Data;
      const seleccion = Number(dataPlan?.seleccion || 0);
      const planDocente = Array.isArray(dataPlan?.plan_docente)
        ? dataPlan.plan_docente[seleccion] ?? dataPlan.plan_docente[0]
        : dataPlan?.plan_docente;

      if (typeof planDocente === "string") {
        return String(planDocente).trim();
      }

      return String(planDocente?._id || planDocente?.id || "").trim();
    } catch (error) {
      console.warn("No fue posible resolver el plan docente desde la preasignación", error);
      return "";
    }
  }

  private async esPtdAprobado(preasignacion: any): Promise<boolean> {
    const planDocenteId = await this.resolverPlanDocenteId(preasignacion);
    if (!planDocenteId) {
      return false;
    }

    const estadoAprId = await this.obtenerEstadoPlanAprobadoId();
    if (!estadoAprId) {
      return false;
    }

    try {
      const planResp: any = await firstValueFrom(
        this.planTrabajoDocenteService.get("plan_docente/" + planDocenteId)
      );

      const estadoPlanId = String(planResp?.Data?.estado_plan_id || "").trim();
      return estadoPlanId === estadoAprId;
    } catch (error) {
      console.warn("No fue posible consultar el estado del plan docente", error);
      return false;
    }
  }

  accionEditar(event: any) {
    if (!this.permisos['tabla_coordinador']) {
      return this.popUpManager.showErrorToast(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
    }

    const preasignacion = event["rowData"];
    this.esPtdAprobado(preasignacion).then((ptdAprobado) => {
      if (ptdAprobado) {
        this.popUpManager.showErrorAlert(
          this.translate.instant("ptd.no_editar_borrar_ptd_aprobado")
        );
        return;
      }

      this.popUpManager
        .showPopUpGeneric(
          this.translate.instant("ptd.preasignacion"),
          this.translate.instant("ptd.pregunta_editar"),
          MODALS.INFO,
          false
        )
        .then((action) => {
          if (action.value) {
            this.dialogConfig.data = preasignacion;
            const preasignacionDialog = this.dialog.open(
              DialogoPreAsignacionPtdComponent,
              this.dialogConfig
            );
            preasignacionDialog.afterClosed().subscribe((result) => {
              if (result) {
                this.resetearAprobacionProyecto(preasignacion).then(() => {
                  this.limpiarCargaPlanDePreasignacion(preasignacion).then(() => {
                    this.loadPreasignaciones();
                  });
                });
              } else {
                this.loadPreasignaciones();
              }
            });
          }
        });
    });
  }

  preguntarBorradoPreAsignacion(event: any) {
    if (!this.permisos['tabla_coordinador']) {
      return this.popUpManager.showErrorToast(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
    }

    const preasignacion = event.rowData;
    this.esPtdAprobado(preasignacion).then((ptdAprobado) => {
      if (ptdAprobado) {
        this.popUpManager.showErrorAlert(
          this.translate.instant("ptd.no_editar_borrar_ptd_aprobado")
        );
        return;
      }

      this.popUpManager
        .showConfirmAlert(this.translate.instant("ptd.pregunta_eliminar"))
        .then((action) => {
          if (action.value) {
            this.popUpManager
              .showConfirmAlert(
                this.translate.instant(
                  "ptd.eliminar_preasignacion_tiene_repetir_proceso_ptd"
                )
              )
              .then((action) => {
                if (action.value) {
                  this.eliminarPreAsignacion(preasignacion);
                }
              });
          }
        });
    });
  }

  eliminarPreAsignacion(preasignacion: any) {
    this.planDocenteMid
      .delete("preasignacion", { Id: preasignacion.id })
      .subscribe({
        next: async (resp: RespFormat) => {
          if (resp.Message == "tiene colocaciones") {
            return this.popUpManager.showErrorAlert(
              this.translate.instant(
                "ptd.no_poder_eliminar_preasignacion_tiene_colocaciones"
              )
            );
          }

          // Resetear aprobación de proyecto para otras preasignaciones del mismo proyecto
          try {
            await this.resetearAprobacionProyecto(preasignacion);
          } catch (error) {
            console.warn("No se pudo resetear las aprobaciones del proyecto", error);
          }

          // Limpiar la carga del espacio académico de la preasignación eliminada
          try {
            await this.limpiarCargaPlanDePreasignacion(preasignacion);
          } catch (error) {
            console.warn("No se pudo limpiar la carga al eliminar la preasignación", error);
          }

          this.popUpManager.showSuccessAlert(
            this.translate.instant("ptd.preasignacion_eliminada")
          );

          this.loadPreasignaciones();
        },
        error: (err) => {
          this.popUpManager.showErrorToast(
            this.translate.instant("ptd.error_preasignacion_eliminada")
          );
        },
      });
  }

  agregacionPreasignacion() {
    if (!this.permisos['nueva_preasignacion']) {
      return this.popUpManager.showErrorToast(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
    }

    this.dialogConfig.data = {};
    const preasignacionDialog = this.dialog.open(
      DialogoPreAsignacionPtdComponent,
      this.dialogConfig
    );
    preasignacionDialog.afterClosed().subscribe((result) => {
      this.loadPreasignaciones();
    });
  }

  enviarAprobacion() {
    if (!this.permisos['aprobacion_docente']) {
      return this.popUpManager.showErrorToast(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
    }

    this.popUpManager
      .showPopUpGeneric(
        this.translate.instant("GLOBAL.enviar_aprobacion"),
        this.translate.instant("ptd.pregunta_enviar_a_coordinacion"),
        MODALS.QUESTION,
        false
      )
      .then((action) => {
        if (action.value) {
          const preasignacionesSeleccionadas = this.dataSource.data.filter((preasignacion: any) =>
            !!preasignacion?.aprobacion_docente?.seleccionado
          );

          if (!preasignacionesSeleccionadas.length) {
            return this.popUpManager.showErrorToast(
              this.translate.instant("ptd.no_hay_pendientes_aprobacion_coordinacion")
            );
          }

          let req: {
            preasignaciones: { Id: any }[];
            "no-preasignaciones": { Id: any }[];
            docente: boolean;
          } = {
            preasignaciones: [],
            "no-preasignaciones": [],
            docente: true,
          };
          preasignacionesSeleccionadas.forEach((preasignacion) => {
            req.preasignaciones.push({ Id: preasignacion.id });
          });
          this.planDocenteMid.put("preasignacion/aprobar", req).subscribe({
            next: (resp: RespFormat) => {
              if (checkResponse(resp)) {
                this.popUpManager.showSuccessAlert(
                  this.translate.instant("ptd.aprobacion_preasignacion")
                );
              } else {
                this.popUpManager.showErrorAlert(
                  this.translate.instant("ptd.error_aprobacion_preasignacion")
                );
              }
              this.loadPreasignaciones();
            },
            error: (err) => {
              this.popUpManager.showErrorToast(
                this.translate.instant("ptd.error_aprobacion_preasignacion")
              );
            },
          });
        }
      });
  }

  loadPreasignaciones() {
    this.dataSource.filter = '';

    if (this.vistaActiva === 'coordinador') {
      if (!this.permisos['tabla_coordinador']) {
        this.dataSource.data = [];
        this.popUpManager.showErrorToast(
          this.translate.instant('GLOBAL.acceso_denegado')
        );
        this.attachPaginatorAndSort();
        return;
      }

      if (!this.proyecto || !this.proyecto.Codigo) {
        this.dataSource.data = [];
        this.popUpManager.showErrorToast(
          this.translate.instant('GLOBAL.debe_seleccionar_proyecto')
        );
        this.attachPaginatorAndSort();
        return;
      }

      this.planDocenteMid
        .get(`preasignacion?vigencia=${this.periodo.Id}`)
        .subscribe({
          next: (resp: RespFormat) => {
            this.hasAttemptedToLoad = true;
            if (checkResponse(resp)) {
              const datosFiltrados = (Array.isArray(resp.Data) ? resp.Data : []).filter((preasignacion: any) =>
                String(preasignacion?.codigo_proyecto_academico || "").trim() === String(this.proyecto?.Codigo || "").trim()
              );
              this.dataSource.data = datosFiltrados.map((preasignacion: any) => ({
                ...preasignacion,
                aprobacion_docente: {
                  ...preasignacion.aprobacion_docente,
                  seleccionado: false,
                },
              }));
              this.dataSource.paginator?.firstPage();
            } else {
              this.dataSource.data = [];
              this.popUpManager.showErrorAlert(
                this.translate.instant("ptd.error_no_found_preasignaciones")
              );
            }
            this.attachPaginatorAndSort();
          },
          error: () => {
            this.hasAttemptedToLoad = true;
            this.dataSource.data = [];
            this.popUpManager.showErrorToast(
              this.translate.instant("ptd.error_no_found_preasignaciones")
            );
            this.attachPaginatorAndSort();
          },
        });
      return;
    }

    if (this.vistaActiva === 'docente') {
      if (!this.permisos['tabla_docente']) {
        this.dataSource.data = [];
        this.popUpManager.showErrorToast(
          this.translate.instant('GLOBAL.acceso_denegado')
        );
        this.attachPaginatorAndSort();
        return;
      }

      this.userService
        .getPersonaId()
        .then((id_tercero) => {
          this.planDocenteMid
            .get(
              "preasignacion/docente?docente=" +
                id_tercero +
                "&vigencia=" +
                this.periodo.Id
            )
            .subscribe({
              next: (resp: RespFormat) => {
                this.hasAttemptedToLoad = true;
                if (checkResponse(resp)) {
                  this.dataSource.data = (Array.isArray(resp.Data) ? resp.Data : []).map((preasignacion: any) => ({
                    ...preasignacion,
                    aprobacion_docente: {
                      ...preasignacion.aprobacion_docente,
                      seleccionado: false,
                    },
                  }));
                  this.dataSource.paginator?.firstPage();
                } else {
                  this.dataSource.data = [];
                  this.popUpManager.showErrorAlert(
                    this.translate.instant("ptd.error_no_found_preasignaciones")
                  );
                }
                this.attachPaginatorAndSort();
              },
              error: () => {
                this.hasAttemptedToLoad = true;
                this.dataSource.data = [];
                this.popUpManager.showErrorToast(
                  this.translate.instant("ptd.error_no_found_preasignaciones")
                );
                this.attachPaginatorAndSort();
              },
            });
        })
        .catch(() => {
          this.dataSource.data = [];
          this.popUpManager.showErrorToast(
            this.translate.instant("GLOBAL.error_no_found_tercero_id")
          );
          this.attachPaginatorAndSort();
        });
      return;
    }

    this.dataSource.data = [];
    this.popUpManager.showErrorToast(
      this.translate.instant("GLOBAL.acceso_denegado")
    );
    this.attachPaginatorAndSort();
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

  selectProyecto(proyecto: any) {
    this.proyecto = proyecto.value;
    this.periodo = new Periodo({});
    this.periodosFiltrados = [];
    this.dataSource.data = [];
    this.dataSource.filter = '';
    this.hasAttemptedToLoad = false;
    if (this.proyecto) {
      this.filtrarPeriodosPorCalendario();
    }
  }

  selectPeriodo(periodo: any) {
    this.periodo = periodo.value;
    this.dataSource.data = [];
    this.dataSource.filter = '';
    this.hasAttemptedToLoad = false;
    if (this.periodo) {
      this.verificarRangoFechas();
      if (!this.enRangoCalendario) {
        this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
        return;
      }
      this.loadPreasignaciones();
    }
  }

  // Función para determinar el estado del semáforo de preasignación
  getSemaforoPreasignacion(row: any): {
    color: string;
    tooltip: string;
    icon: string;
  } {
    const aprobacionDocente = this.getAprobacionValue(row?.aprobacion_docente);
    const aprobacionProyecto = this.getAprobacionValue(row?.aprobacion_proyecto);

    if (aprobacionProyecto) {
      return {
        color: "#4CAF50",
        tooltip: this.translate.instant("ptd.semaforo_preasignacion_aprobada"),
        icon: "check_circle",
      };
    }

    if (aprobacionDocente) {
      return {
        color: "#FFC107",
        tooltip: this.translate.instant(
          "ptd.semaforo_preasignacion_pendiente_docente"
        ),
        icon: "autorenew",
      };
    }

    return {
      color: "#F44336",
      tooltip: this.translate.instant("ptd.semaforo_preasignacion_no_enviado"),
      icon: "cancel",
    };
  }

  private getAprobacionValue(approval: any): boolean {
    if (typeof approval === "boolean") {
      return approval;
    }

    if (approval && typeof approval === "object" && "value" in approval) {
      return !!approval.value;
    }

    return false;
  }
}
