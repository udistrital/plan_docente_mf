import { AfterViewInit, Component, OnInit, ViewChild } from "@angular/core";
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
import { ProyectoAcademicoService } from "src/app/services/proyecto-academico.service";
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
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  dialogConfig: MatDialogConfig;

  constructor(
    private userService: UserService,
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private parametrosService: ParametrosService,
    private planDocenteMid: SgaPlanTrabajoDocenteMidService,
    private planTrabajoDocenteService: PlanTrabajoDocenteService,
    private proyectoAcademicoService: ProyectoAcademicoService,
    private dialog: MatDialog,
    private permisosUtils: PermisosUtils,
    private academicaJbpmService: AcademicaJbpmService
  ) {
    this.dataSource = new MatTableDataSource();
    this.dialogConfig = new MatDialogConfig();
  }

  async ngOnInit() {
    this.popUpManager.showLoading();
    try{
      await this.cargarEventoPTD();
      // Espera roles
      const roles = await this.userService.getUserRoles();
      this.roles = roles;
      // Construcción observables permisos
      const observables: { [key: string]: Observable<boolean> } = {};
      this.opcionesPermisos.forEach(opcion => {
        observables[opcion] =
          this.permisosUtils.tienePermiso(
            roles,
            opcion
          );

      });
      // Espera todos los permisos
      this.permisos = await firstValueFrom(
        forkJoin(observables)
      );
      this.periodos =await this.cargarPeriodo();
      this.dialogConfig.width = "65vw";
      this.dialogConfig.minWidth = "700px";
      this.dialogConfig.height = "65vh";
      this.dialogConfig.maxHeight = "615px";
      this.dialogConfig.data = {};
    }catch(err){
      this.popUpManager.showErrorAlert(this.translate.instant("ERROR.persiste_error_comunique_OAS"));
    } finally {
      this.popUpManager.closeLoading();
    }
  }

  async cargarEventoPTD(): Promise<void> {
    const resp: any = await firstValueFrom(
      this.planDocenteMid.get("calendario/eventos")
    );

    if (checkContent(resp)) {

      const eventos = Array.isArray(resp.Data)
        ? resp.Data
        : [];

      const evento = eventos.find(
        (e: any) =>
          e.Descripcion === "PLANES DE TRABAJO DOCENTES"
      );

      if (evento) {

        this.codigoEventoPTD = evento.CodigoEvento;

        const eventosCalendario =
          await this.cargarCalendarioEventos();

        this.calendarEventosPTD = eventosCalendario;

        this.resolverProyectosDesdeCalendario();
      }
    }
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
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
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

  private obtenerProyectosCoordinador(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const documentoCoordinador = this.obtenerDocumentoCoordinador();
      if (!documentoCoordinador) {
        reject(new Error("No fue posible obtener el documento del coordinador"));
        return;
      }
      this.academicaJbpmService.get(`coordinador_usuario/${documentoCoordinador}`).subscribe({
        next: (resp: any) => {
          if (Array.isArray(resp.coordinadores.coordinador)) {
            resolve(resp.coordinadores.coordinador);
          } else {
            reject(new Error("No se encontraron proyectos para el coordinador"));
          }
        },
        error: (err) => {
          reject(err);
        },
      });
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  private async limpiarCargaPlanDePreasignacion(preasignacion: any): Promise<boolean> {
    if (!preasignacion?.docente_id || !preasignacion?.periodo_id || !preasignacion?.tipo_vinculacion_id) {
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

      const idsADescartar = cargaActual
        .map((carga: any) => ({ id: carga.id }))
        .filter((carga: any) => !!String(carga.id || "").trim());

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

  accionEnviar(event: any) {
    if (!this.permisos['tabla_coordinador']) {
      return this.popUpManager.showErrorToast(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
    }

    this.popUpManager
      .showPopUpGeneric(
        this.translate.instant("ptd.enviar_a_docente"),
        this.translate.instant("ptd.pregunta_enviar_a_docente"),
        MODALS.INFO,
        false
      )
      .then(async (action) => {
        if (action.value) {
          this.popUpManager.showLoading();
          try {
            let data = {
              preasignaciones: [{ Id: event["rowData"].id }],
              "no-preasignaciones": [],
              docente: false,
            };

            const resp: RespFormat = await firstValueFrom(
              this.planDocenteMid.put("preasignacion/aprobar", data)
            );
            this.popUpManager.closeLoading();
            if (checkResponse(resp)) {
              this.popUpManager.showSuccessAlert(
                this.translate.instant("ptd.aprobacion_preasignacion")
              );
            } else {
              this.popUpManager.showErrorAlert(
                this.translate.instant("ptd.error_aprobacion_preasignacion")
              );
            }
            await this.loadPreasignaciones();
          } catch (err: any) {
            this.popUpManager.closeLoading();
            console.warn(err);
            this.popUpManager.showErrorToast(
              this.translate.instant("ptd.error_aprobacion_preasignacion")
            );
          }
        }
      });
  }

  accionEditar(event: any) {
    if (!this.permisos['tabla_coordinador']) {
      return this.popUpManager.showErrorToast(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
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
          const preasignacion = event["rowData"];
          this.dialogConfig.data = preasignacion;
          const preasignacionDialog = this.dialog.open(
            DialogoPreAsignacionPtdComponent,
            this.dialogConfig
          );
          preasignacionDialog.afterClosed().subscribe((result) => {
            if (result) {
              this.limpiarCargaPlanDePreasignacion(preasignacion).then(() => {
                this.loadPreasignaciones();
              });
            } else {
              this.loadPreasignaciones();
            }
          });
        }
      });
  }

  preguntarBorradoPreAsignacion(event: any) {
    if (!this.permisos['tabla_coordinador']) {
      return this.popUpManager.showErrorToast(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
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
                this.eliminarPreAsignacion(event.rowData.id);
              }
            });
        }
      });
  }

  eliminarPreAsignacion(preAsignacionId: any) {
    this.planDocenteMid
      .delete("preasignacion", { Id: preAsignacionId })
      .subscribe({
        next: (resp: RespFormat) => {
          if (resp.Message == "tiene colocaciones") {
            return this.popUpManager.showErrorAlert(
              this.translate.instant(
                "ptd.no_poder_eliminar_preasignacion_tiene_colocaciones"
              )
            );
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
      .then(async (action) => {
        if (action.value) {
          this.popUpManager.showLoading();
          try {
            let req: {
              preasignaciones: { Id: any }[];
              "no-preasignaciones": { Id: any }[];
              docente: boolean;
            } = {
              preasignaciones: [],
              "no-preasignaciones": [],
              docente: true,
            };
            this.dataSource.data.forEach((preasignacion) => {
              if (preasignacion.aprobacion_docente.value) {
                req.preasignaciones.push({ Id: preasignacion.id });
              } else {
                req["no-preasignaciones"].push({ Id: preasignacion.id });
              }
            });
            const resp: RespFormat = await firstValueFrom(
              this.planDocenteMid.put("preasignacion/aprobar", req)
            );
            this.popUpManager.closeLoading();
            if (checkResponse(resp)) {
              this.popUpManager.showSuccessAlert(
                this.translate.instant("ptd.aprobacion_preasignacion")
              );
            } else {
              this.popUpManager.showErrorAlert(
                this.translate.instant("ptd.error_aprobacion_preasignacion")
              );
            }
            await this.loadPreasignaciones();
          } catch (err: any) {
            this.popUpManager.closeLoading();
            console.warn(err);
            this.popUpManager.showErrorToast(
              this.translate.instant("ptd.error_aprobacion_preasignacion")
            );
          }
        }
      });
  }

  async loadPreasignaciones() {
    if (this.permisos['tabla_coordinador']) {
      try {
        const resp: RespFormat = await firstValueFrom(
          this.planDocenteMid.get("preasignacion?vigencia=" + this.periodo.Id)
        );
        if (checkResponse(resp)) {
          let data = resp.Data;
          if (this.proyecto && this.proyecto.Id && !this.roles.includes(ROLES.DOCENTE)) {
            data = data.filter((item: any) => String(item.codigo_proyecto_academico) === String(this.proyecto.Id));
          }
          this.dataSource = new MatTableDataSource(data);
        } else {
          this.dataSource = new MatTableDataSource();
          this.popUpManager.showErrorAlert(
            this.translate.instant("ptd.error_no_found_preasignaciones")
          );
        }
      } catch (err: any) {
        this.dataSource = new MatTableDataSource();
        this.popUpManager.showErrorToast(
          this.translate.instant("ptd.error_no_found_preasignaciones")
        );
      }
    } else if (this.permisos['tabla_docente']) {
      try {
        const id_tercero = await this.userService.getPersonaId();
        const resp: RespFormat = await firstValueFrom(
          this.planDocenteMid.get(
            "preasignacion/docente?docente=" +
              id_tercero +
              "&vigencia=" +
              this.periodo.Id
          )
        );
        if (checkResponse(resp)) {
          let data = resp.Data;
          if (this.proyecto && this.proyecto.Id && !this.roles.includes(ROLES.DOCENTE)) {
            data = data.filter((item: any) => String(item.codigo_proyecto_academico) === String(this.proyecto.Id));
          }
          this.dataSource = new MatTableDataSource(data);
        } else {
          this.dataSource = new MatTableDataSource();
          this.popUpManager.showErrorAlert(
            this.translate.instant("ptd.error_no_found_preasignaciones")
          );
        }
      } catch (err: any) {
        this.dataSource = new MatTableDataSource();
        if (err.message && err.message.includes('tercero_id')) {
          this.popUpManager.showErrorToast(
            this.translate.instant("GLOBAL.error_no_found_tercero_id")
          );
        } else {
          this.popUpManager.showErrorToast(
            this.translate.instant("ptd.error_no_found_preasignaciones")
          );
        }
      }
    } else {
      this.dataSource = new MatTableDataSource();
      this.popUpManager.showErrorToast(
        this.translate.instant("GLOBAL.acceso_denegado")
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

  selectProyecto(proyecto: any) {
    this.proyecto = proyecto.value;
    this.periodo = new Periodo({});
    this.periodosFiltrados = [];
    this.dataSource = new MatTableDataSource();
    if (this.proyecto) {
      this.filtrarPeriodosPorCalendario();
    }
  }

  async selectPeriodo(periodo: any) {
    this.periodo = periodo.value;
    this.dataSource = new MatTableDataSource();
    if (this.periodo) {
      this.verificarRangoFechas();
      if (!this.enRangoCalendario) {
        this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
        return;
      }
      this.popUpManager.showLoading();
      try {
        await this.loadPreasignaciones();
      } catch (err) {
        console.warn(err);
        this.popUpManager.showErrorToast(this.translate.instant("ERROR.persiste_error_comunique_OAS"));
      } finally {
        this.popUpManager.closeLoading();
      }
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
