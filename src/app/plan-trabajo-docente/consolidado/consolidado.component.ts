import { AfterViewInit, Component, OnInit, ViewChild } from "@angular/core";
import { MatPaginator } from "@angular/material/paginator";
import { MatSort } from "@angular/material/sort";
import { MatTableDataSource } from "@angular/material/table";
import { MODALS, ROLES, VIEWS } from "src/app/models/diccionario";
import { UserService } from "src/app/services/user.service";
import { cloneDeep as _cloneDeep } from "lodash-es";
import { Periodo } from "src/app/models/parametros/periodo";
import { TranslateService } from "@ngx-translate/core";
import { PopUpManager } from "src/app/managers/popUpManager";
import { PlanTrabajoDocenteService } from "src/app/services/plan-trabajo-docente.service";
import { ParametrosService } from "src/app/services/parametros.service";
import { RespFormat } from "src/app/models/response-format";
import { checkContent, checkResponse } from "src/app/utils/verify-response";
import { EstadoConsolidado } from "src/app/models/plan-trabajo-docente/estado-consolidado";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MatDialog, MatDialogConfig } from "@angular/material/dialog";
import { DialogPreviewFileComponent } from "src/app/dialog-components/dialog-preview-file/dialog-preview-file.component";
import { TercerosService } from "src/app/services/terceros.service";
import { SgaPlanTrabajoDocenteMidService } from "src/app/services/sga-plan-trabajo-docente-mid.service";
import { GestorDocumentalService } from "src/app/services/gestor-documental.service";
import { DocumentoService } from "src/app/services/documento.service";
import { Observable } from "rxjs/internal/Observable";
import { forkJoin } from "rxjs/internal/observable/forkJoin";
import { firstValueFrom } from "rxjs/internal/firstValueFrom";
import { PermisosUtils } from "src/app/utils/role-permissions";

@Component({
    selector: "app-consolidado",
    templateUrl: "./consolidado.component.html",
    styleUrls: ["./consolidado.component.scss"],
    standalone: false
})
export class ConsolidadoComponent implements OnInit, AfterViewInit {
  readonly VIEWS = VIEWS;
  // Código de abreviación para tipo de documento de soportes PTD
  private readonly codigoAbreviacionTipoDocPtd = "SOPPLTRDOC";
  private tipoDocumentoPtdId: number | null = null;
  /* readonly MODALS = MODALS;
  readonly ACTIONS = ACTIONS; */
  vista: Symbol;

  roles: string[] = [];

  opcionesPermisos: string[] = [
    'ver_gestion_consolidado',
    'editar_gestion_consolidado',
    'nuevo_consolidado',
    'enviar_coordinador_consolidado',
    'ver_consolidados_coordinacion',
  ];
  permisos: { [key: string]: boolean } = {};

  dataSource: MatTableDataSource<any>;
  displayedColumns: string[] = [
    "proyecto_curricular",
    "codigo",
    "fecha_radicado",
    "periodo_academico",
    "revision_decanatura",
    "gestion",
    "estado",
    "enviar",
  ];
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  periodos: { select: any; opciones: Periodo[] };
  proyectos: { select: any; opciones: any[] };
  estadosConsolidado: { select: any; opciones: any[] };

  formNewEditConsolidado: FormGroup;
  newEditConsolidado: boolean;
  consolidadoSololectura: boolean;

  formRespuestaConsolidado: FormGroup;
  respuestaConsolidado: boolean;

  consolidadoInfo: any = undefined;

  listaPlanesConsolidado: any = undefined;

  archivoNombre = "";
  archivoExistenteUrl: string | null = null;
  archivoExistenteNombre: string | null = null;
  documentoIdActual: number | null = null;
  codigoEventoPTD: string = '';
  calendarEventosPTD: any[] = [];
  calendarEventoSeleccionado: any = null;
  enRangoCalendario: boolean = false;
  _todosLosPeriodos: Periodo[] = [];

  constructor(
    private userService: UserService,
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private planTrabajoDocenteService: PlanTrabajoDocenteService,
    private parametrosService: ParametrosService,
    private tercerosService: TercerosService,
    private sgaPlanTrabajoDocenteMidService: SgaPlanTrabajoDocenteMidService,
    private gestorDocumentalService: GestorDocumentalService,
    private documentoService: DocumentoService,
    private builder: FormBuilder,
    private matDialog: MatDialog,
    private permisosUtils:PermisosUtils
  ) {
    this.vista = VIEWS.LIST;
    this.dataSource = new MatTableDataSource();
    this.periodos = { select: undefined, opciones: [] };
    this.proyectos = { select: undefined, opciones: [] };
    this.estadosConsolidado = { select: undefined, opciones: [] };
    this.formNewEditConsolidado = this.builder.group({});
    this.consolidadoSololectura = false;
    this.formRespuestaConsolidado = this.builder.group({});
    this.newEditConsolidado = false;
    this.respuestaConsolidado = false;
  }

  async ngOnInit() {
    this.popUpManager.showLoading();
    try {
      await this.cargarEventoPTD();
      const roles = await this.userService.getUserRoles();
      this.roles = roles;
      const observables: { [key: string]: Observable<boolean> } = {};
      this.opcionesPermisos.forEach(opcion => {
        observables[opcion] =
          this.permisosUtils.tienePermiso(roles, opcion);
      });
      const resultados = await firstValueFrom(forkJoin(observables));
      this.permisos = resultados;
      console.log("Permisos cargados:", this.permisos);
      await this.loadSelects();
      this.buildForms();
    } catch (err) {
      this.popUpManager.showErrorAlert(this.translate.instant("ERROR.persiste_error_comunique_OAS"));
    } finally {
      this.popUpManager.closeLoading();
    }
  }

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  private configurarDataSource(data: any[] = []) {
    const dataSource = new MatTableDataSource(data);
    dataSource.paginator = this.paginator;
    dataSource.sort = this.sort;
    return dataSource;
  }

  cargarEventoPTD() {
    this.sgaPlanTrabajoDocenteMidService.get("calendario/eventos").subscribe({
      next: (resp: any) => {
        if (checkContent(resp)) {
          const eventos = Array.isArray(resp.Data) ? resp.Data : [];
          const evento = eventos.find((e: any) => e.Descripcion === "PLANES DE TRABAJO DOCENTES");
          if (evento) {
            this.codigoEventoPTD = evento.CodigoEvento;
            this.cargarCalendarioEventos().then(eventosCalendario => {
              this.calendarEventosPTD = eventosCalendario;
              this.resolverProyectosDesdeCalendario();
              this.verificarRangoFechas();
              this.intentarListarConsolidados();
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

  resolverProyectosDesdeCalendario() {
    if (!this.calendarEventosPTD || this.calendarEventosPTD.length === 0) return;
    const proyectosMap = new Map<string, any>();
    this.calendarEventosPTD.forEach((evento: any) => {
      const id = String(evento.CodigoProyecto);
      if (id && evento.NombreProyecto && !proyectosMap.has(id)) {
        proyectosMap.set(id, { Id: id, Codigo: id, Nombre: evento.NombreProyecto });
      }
    });
    this.proyectos.opciones = Array.from(proyectosMap.values());
  }

  private intentarListarConsolidados() {
    if (this.periodos.select && this.proyectos.select && this.enRangoCalendario) {
      this.listarConsolidados();
    }
  }

  filtrarPeriodosPorCalendario() {
    if (!this.calendarEventosPTD || this.calendarEventosPTD.length === 0) {
      this.periodos.opciones = [];
      return;
    }
    const eventosDelProyecto = this.calendarEventosPTD.filter((e: any) =>
      String(e.CodigoProyecto) === String(this.proyectos.select?.Id)
    );
    const todosLosPeriodos = this._todosLosPeriodos || this.periodos.opciones;
    const vistos = new Set<string>();
    this.periodos.opciones = todosLosPeriodos.filter((periodo: Periodo) => {
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
    if (!this.periodos.select || !this.proyectos.select || !this.calendarEventosPTD || this.calendarEventosPTD.length === 0) {
      return;
    }
    const eventoMatch = this.calendarEventosPTD.find((evento: any) =>
      String(evento.CodigoProyecto) === String(this.proyectos.select.Id) &&
      String(evento.Year) === String(this.periodos.select.Year) &&
      String(evento.Ciclo) === String(this.periodos.select.Ciclo)
    );
    if (eventoMatch) {
      this.calendarEventoSeleccionado = eventoMatch;
      const ahora = new Date();
      const fechaInicio = new Date(eventoMatch.FechaInicio);
      const fechaFin = new Date(eventoMatch.FechaFin);
      this.enRangoCalendario = ahora >= fechaInicio && ahora <= fechaFin;
      console.log('--- Consolidado: Verificar Rango Fechas ---');
      console.log('Fecha actual:', ahora);
      console.log('Fecha Inicio Evento:', fechaInicio);
      console.log('Fecha Fin Evento:', fechaFin);
      console.log('¿Está en rango?:', this.enRangoCalendario);
    }
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  buildForms() {
    this.formNewEditConsolidado = this.builder.group({
      ArchivoSoporte: [""], // Inicialmente sin validación, se agrega dinámicamente
      QuienEnvia: ["", Validators.required],
      Rol: ["", Validators.required],
    });
    this.formRespuestaConsolidado = this.builder.group({
      Respuesta: ["", Validators.required],
      Observaciones: ["", Validators.required],
    });
  }

  onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : undefined;

    if (file) {
      this.archivoNombre = file.name;
      this.formNewEditConsolidado.patchValue({
        ArchivoSoporte: { file },
      });
    } else {
      this.archivoNombre = "";
      this.formNewEditConsolidado.patchValue({ ArchivoSoporte: "" });
    }

    this.formNewEditConsolidado.get("ArchivoSoporte")?.markAsDirty();
    this.formNewEditConsolidado
      .get("ArchivoSoporte")
      ?.updateValueAndValidity();

    if (input) {
      input.value = "";
    }
  }

  accionRevision(event: any) {
    this.verRevDecano(event.rowData.ConsolidadoJson);
  }

  accionGestion(event: any) {
    const canViewGestion =
      this.permisos['ver_gestion_consolidado'] ||
      this.permisos['editar_gestion_consolidado'];

    if (!canViewGestion) {
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }

    if (
      event.rowData.gestion.type === 'editar' &&
      !this.permisos['editar_gestion_consolidado']
    ) {
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }

    this.consolidadoSololectura = event.rowData.gestion.type === 'ver';
    this.nuevoEditarConsolidado(event.rowData.ConsolidadoJson);
  }

  async accionEnviar(event: any) {
    if (!this.permisos['enviar_coordinador_consolidado']) {
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }
    const consolidado = event.rowData.ConsolidadoJson;

    // Obtener el id del estado 'ENV'
    const estadoEnv = this.estadosConsolidado.opciones.find(
      (estado) => estado.codigo_abreviacion === "ENV"
    );
    if (!estadoEnv) {
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.fallo_actualizar_consolidado")
      );
      return;
    }

    // Verificar que no exista otro consolidado en estado 'ENV' para mismo periodo y proyecto
    try {
      const periodoId = consolidado.periodo_id || this.periodos.select?.Id;
      const proyectoId = consolidado.proyecto_academico_id || this.proyectos.select?.Id || 0;
      const query = `consolidado_docente?query=activo:true,periodo_id:${periodoId},proyecto_academico_id:${proyectoId},estado_consolidado_id:${estadoEnv._id}&limit=0`;
      const resp: any = await firstValueFrom(this.planTrabajoDocenteService.get(query));
      const existentes: any[] = resp?.Data ?? [];
      const otrosEnviados = existentes.filter((c: any) => String(c._id) !== String(consolidado._id));
      if (otrosEnviados.length > 0) {
        this.popUpManager.showPopUpGeneric(
          "",
          "Ya existe otro consolidado en estado 'Enviado' para este periodo y proyecto. No es posible realizar el envío.",
          MODALS.INFO,
          false
        );
        return;
      }
    } catch (err) {
      console.warn('Error verificando consolidado enviado existente:', err);
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.fallo_actualizar_consolidado")
      );
      return;
    }

    try {
      // Si pasa la verificación, proceder a cambiar el estado a ENV
      const putPlan = _cloneDeep(consolidado);
      putPlan.estado_consolidado_id = estadoEnv._id;
      await firstValueFrom(
        this.planTrabajoDocenteService.put("consolidado_docente/" + putPlan._id, putPlan)
      );
      this.popUpManager.closeLoading();
      this.popUpManager.showSuccessAlert(
        this.translate.instant("ptd.actualizar_consolidado_ok")
      );
      await this.listarConsolidados();
    } catch (err) {
      this.popUpManager.closeLoading();
      console.warn(err);
      this.popUpManager.showErrorAlert(
        this.translate.instant("ptd.fallo_actualizar_consolidado")
      );
    }
  }

  loadPeriodo(): Promise<Periodo[]> {
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


  private obtenerDocumentoCoordinador(): string | null {
    try {
      const userEncoded = window.localStorage.getItem("user");
      if (!userEncoded) return null;
      const decoded = JSON.parse(atob(userEncoded));
      const posiblesDocumentos: any[] = [
        decoded?.user?.documento, decoded?.userService?.documento,
        decoded?.user?.documento_compuesto, decoded?.userService?.documento_compuesto
      ];
      for (const valor of posiblesDocumentos) {
        const documento = String(valor ?? "").trim();
        if (documento) return documento;
      }
    } catch { return null; }
    return null;
  }


  cargarEstadosConsolidado(): Promise<EstadoConsolidado[]> {
    return new Promise((resolve, reject) => {
      this.planTrabajoDocenteService
        .get("estado_consolidado?query=activo:true&limit=0")
        .subscribe({
          next: (res) => {
            if (res.Data.length > 0) {
              resolve(res.Data);
            } else {
              reject(new Error("No se encontraron estados de plan"));
            }
          },
          error: (err) => {
            reject(err);
          },
        });
    });
  }

  async loadSelects() {
    try {
      let promesas: Promise<void>[] = [];
      promesas.push(
        this.loadPeriodo().then((periodos) => {
          this.periodos.opciones = periodos;
          this._todosLosPeriodos = [...periodos];
        }),
        this.cargarEstadosConsolidado().then((estadosConsolidado) => {
          this.estadosConsolidado.opciones = estadosConsolidado;
        })
      );
      await Promise.all(promesas);
    } catch (error) {
      console.warn(error);
      this.popUpManager.showPopUpGeneric(
        this.translate.instant("ERROR.titulo_generico"),
        this.translate.instant("ERROR.sin_informacion_en") +
        ": <b>" +
        error +
        "</b>.<br><br>" +
        this.translate.instant("ERROR.persiste_error_comunique_OAS"),
        MODALS.ERROR,
        false
      );
    }
  }

  onProyectoChange() {
    this.periodos.select = undefined;
    this.periodos.opciones = [];
    this.dataSource = this.configurarDataSource();
    if (this.proyectos.select) {
      this.filtrarPeriodosPorCalendario();
    }
  }

  onPeriodoChange() {
    this.dataSource = this.configurarDataSource();
    if (this.periodos.select) {
      this.verificarRangoFechas();
      if (!this.enRangoCalendario) {
        if (this.calendarEventosPTD.length > 0) {
          this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
        }
        return;
      }
      this.intentarListarConsolidados();
    }
  }

  async listarConsolidados() {
    if (!this.permisos['ver_consolidados_coordinacion']){
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }
    this.verificarRangoFechas();
    if (!this.enRangoCalendario) {
      this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
      return;
    }
    if (this.periodos.select) {
      let proyecto = "";
      if (this.proyectos.select && !this.roles.includes(ROLES.DOCENTE)) {
        proyecto = ",proyecto_academico_id:" + this.proyectos.select.Id;
      }
      try {
        const resp: any = await firstValueFrom(
          this.planTrabajoDocenteService.get(
            `consolidado_docente?query=activo:true,periodo_id:${this.periodos.select.Id}${proyecto}&limit=0`
          )
        );
        let rawlistarConsolidados = <any[]>resp.Data;
        const idEstadosFiltro = this.estadosConsolidado.opciones
          .filter((estado) =>
            ["DEF", "ENV", "APR", "N_APR"].includes(
              estado.codigo_abreviacion
            )
          )
          .map((estado) => estado._id);
        rawlistarConsolidados = rawlistarConsolidados.filter(
          (consolidado) =>
            idEstadosFiltro.includes(consolidado.estado_consolidado_id)
        );
        let formatedData: any[] = [];
        rawlistarConsolidados.forEach((consolidado) => {
          const estadoConsolidado = this.estadosConsolidado.opciones.find(
            (estado) => estado._id == consolidado.estado_consolidado_id
          );
          const proyecto = this.proyectos.opciones.find(
            (proyecto) => proyecto.Id == consolidado.proyecto_academico_id
          );
          const periodo = this.periodos.opciones.find(
            (periodo) => periodo.Id == consolidado.periodo_id
          );
          const canViewGestion =
            this.permisos['ver_gestion_consolidado'] ||
            this.permisos['editar_gestion_consolidado'];
          let opcionGestion = "ver";
          if (
            estadoConsolidado &&
            (estadoConsolidado.codigo_abreviacion == "DEF" ||
              estadoConsolidado.codigo_abreviacion == "N_APR") &&
            this.permisos['editar_gestion_consolidado']
          ) {
            opcionGestion = "editar";
          }
          formatedData.push({
            proyecto_curricular: proyecto ? proyecto.Nombre : "",
            codigo: proyecto ? proyecto.Codigo : "",
            fecha_radicado: this.formatoFecha(consolidado.fecha_creacion),
            periodo_academico: periodo ? periodo.Nombre : "",
            revision_decanatura: {
              value: undefined,
              type: "ver",
              disabled: false,
            },
            gestion: {
              value: undefined,
              type: opcionGestion,
              disabled: !canViewGestion,
            },
            estado: estadoConsolidado
              ? estadoConsolidado.nombre
              : consolidado.estado_consolidado_id,
            enviar: {
              value: undefined,
              type: "enviar",
              disabled:
                !this.permisos['enviar_coordinador_consolidado'] ||
                estadoConsolidado.codigo_abreviacion != "DEF",
            },
            ConsolidadoJson: consolidado,
          });
        });
        this.dataSource = new MatTableDataSource(formatedData);
      } catch (err) {
        console.warn(err);
        this.dataSource = new MatTableDataSource();
        throw err;
      }
    }
  }

  formatoFecha(fechaHora: string): string {
    return new Date(fechaHora).toLocaleString("es-CO", {
      timeZone: "America/Bogota",
    });
  }

  valuechanged(event: any) {
    console.info(event);
  }

  nuevoEditarConsolidado(consolidado: any) {
    this.vista = VIEWS.FORM;
    this.newEditConsolidado = true;
    this.formNewEditConsolidado.patchValue({
      Rol:
        this.permisos['ver_consolidados_coordinacion']
          ? ROLES.COORDINADOR
          : "",
      ArchivoSoporte: "",
    });
    this.archivoNombre = "";
    this.archivoExistenteUrl = null;
    this.archivoExistenteNombre = null;
    this.documentoIdActual = null;
    this.listaPlanesConsolidado = "";

    if (consolidado) {
      this.consolidadoInfo = consolidado;

      // Cargar periodo seleccionado
      const periodoId = this.consolidadoInfo.periodo_id;
      if (periodoId) {
        this.periodos.select = this.periodos.opciones.find(
          (periodo) => periodo.Id == periodoId
        );
      }

      // Cargar proyecto seleccionado
      const proyectoId = this.consolidadoInfo.proyecto_academico_id;
      if (proyectoId) {
        this.proyectos.select = this.proyectos.opciones.find(
          (proyecto) => proyecto.Id == proyectoId
        );
      }

      const consolidado_coordinacion = JSON.parse(
        this.consolidadoInfo.consolidado_coordinacion
      );
      const terceroId = consolidado_coordinacion.responsable_id;
      const documentoId = consolidado_coordinacion.documento_id;

      // Cargar archivo existente
      if (documentoId) {
        this.documentoIdActual = documentoId;
        this.cargarArchivoExistente(documentoId);
        // Si hay archivo existente, el campo ArchivoSoporte no es requerido
        this.formNewEditConsolidado.get("ArchivoSoporte")?.clearValidators();
      } else {
        // Si no hay archivo existente, el campo ArchivoSoporte es requerido
        this.formNewEditConsolidado.get("ArchivoSoporte")?.setValidators(Validators.required);
      }
      this.formNewEditConsolidado.get("ArchivoSoporte")?.updateValueAndValidity();

      if (terceroId) {
        this.getInfoResponsable(terceroId);
      } else {
        this.userService
          .getPersonaId()
          .then((terceroId) => {
            this.getInfoResponsable(terceroId);
          })
          .catch(() => {
            this.popUpManager.showPopUpGeneric(
              this.translate.instant("ERROR.titulo_generico"),
              this.translate.instant("ERROR.persiste_error_comunique_OAS"),
              MODALS.ERROR,
              false
            );
          });
      }
    } else {
      this.consolidadoInfo = undefined;
      // Para nuevos consolidados, el campo ArchivoSoporte es requerido
      this.formNewEditConsolidado.get('ArchivoSoporte')?.setValidators(Validators.required);
      this.formNewEditConsolidado.get('ArchivoSoporte')?.updateValueAndValidity();

      this.userService
        .getPersonaId()
        .then((terceroId) => {
          this.getInfoResponsable(terceroId);
        })
        .catch(() => {
          this.popUpManager.showPopUpGeneric(
            this.translate.instant("ERROR.titulo_generico"),
            this.translate.instant("ERROR.persiste_error_comunique_OAS"),
            MODALS.ERROR,
            false
          );
        });
    }
  }

  getInfoResponsable(terceroId: number) {
    this.tercerosService.get("tercero/" + terceroId).subscribe({
      next: (resTerc) => {
        this.formNewEditConsolidado.patchValue({
          QuienEnvia: resTerc.NombreCompleto,
        });
      },
      error: (err) => {
        console.warn(err);
        this.popUpManager.showPopUpGeneric(
          this.translate.instant("ERROR.titulo_generico"),
          this.translate.instant("ERROR.persiste_error_comunique_OAS"),
          MODALS.ERROR,
          false
        );
      },
    });
  }

  cargarArchivoExistente(documentoId: number) {
    this.gestorDocumentalService.get([{
      Id: documentoId,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }]).subscribe({
      next: (resp: any[]) => {
        if (resp && resp.length > 0) {
          this.archivoExistenteUrl = resp[0].url;
          this.archivoExistenteNombre = resp[0].Nombre || "Consolidado.xlsx";
        }
      },
      error: (err) => {
        console.warn("Error al cargar archivo existente:", err);
        this.popUpManager.showErrorAlert(
          this.translate.instant("ERROR.error_cargar_documento")
        );
      }
    });
  }

  descargarArchivoExistente() {
    if (this.archivoExistenteUrl && this.archivoExistenteNombre) {
      const link = document.createElement('a');
      link.href = this.archivoExistenteUrl;
      link.download = this.archivoExistenteNombre;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  private cargarTipoDocumentoSoporte(): Promise<number | null> {
    if (this.tipoDocumentoPtdId) {
      return Promise.resolve(this.tipoDocumentoPtdId);
    }

    return new Promise((resolve) => {
      const endpoint =
        "tipo_documento?query=CodigoAbreviacion:" +
        this.codigoAbreviacionTipoDocPtd +
        ",Activo:true&fields=Id&limit=1";

      this.documentoService.get(endpoint).subscribe(
        (resp: any) => {
          const data = Array.isArray(resp?.Data)
            ? resp.Data
            : Array.isArray(resp)
              ? resp
              : [];
          const id = data?.[0]?.Id ?? null;
          this.tipoDocumentoPtdId = id;
          resolve(id);
        },
        (err) => {
          console.warn("cargarTipoDocumentoSoporte error", err);
          resolve(null);
        }
      );
    });
  }

  private async subirArchivoSoporte(archivoControl: any): Promise<number> {
    const file = (archivoControl as any)?.file as File | undefined;
    if (!file) {
      throw new Error("Archivo soporte requerido");
    }

    const tipoDocId = await this.cargarTipoDocumentoSoporte();
    if (!tipoDocId) {
      throw new Error("No se pudo obtener el tipo de documento para soportes PTD");
    }

    const nombre = file.name?.split(".")[0] || "Consolidado";

    return new Promise((resolve, reject) => {
      this.gestorDocumentalService
        .uploadFiles([
          {
            IdDocumento: tipoDocId,
            nombre: nombre,
            descripcion: "Soporte consolidado PTD",
            file: file,
          },
        ])
        .subscribe(
          (resp: any[]) => resolve(resp[0].res.Id),
          (err) => reject(err)
        );
    });
  }

  async validarFormNewEdit() {
    const archivo = this.formNewEditConsolidado.get("ArchivoSoporte")?.value;
    const responsableId = await this.userService.getPersonaId();
    if (!this.periodos.select || !this.proyectos.select) {
      this.popUpManager.showPopUpGeneric(
        this.translate.instant("ptd.diligenciar_consolidado"),
        this.translate.instant("ptd.select_periodo_proyecto"),
        MODALS.INFO,
        false
      );
      return;
    }

    // Validación especial: si es nuevo consolidado y no hay archivo, mostrar error
    if (this.consolidadoInfo == undefined && !archivo?.file) {
      this.popUpManager.showPopUpGeneric(
        this.translate.instant("ptd.diligenciar_consolidado"),
        this.translate.instant("GLOBAL.carga_documento"),
        MODALS.INFO,
        false
      );
      return;
    }

    if (!this.formNewEditConsolidado.valid) {
      return;
    }

    if (this.consolidadoInfo == undefined) {
      if (this.listaPlanesConsolidado == "") {
        this.popUpManager.showPopUpGeneric(
          this.translate.instant("ptd.diligenciar_consolidado"),
          this.translate.instant("ptd.please_descargue_consolidado"),
          MODALS.INFO,
          false
        );
        return;
      }
      try {
        const documentoId = await this.subirArchivoSoporte(archivo);
        const consolidado = {
          documento_id: documentoId,
          responsable_id: responsableId,
        };
        const prepareData = {
          plan_docente_id: JSON.stringify(this.listaPlanesConsolidado),
          periodo_id: `${this.periodos.select.Id}`,
          proyecto_academico_id: `${this.proyectos.select.Id}`,
          estado_consolidado_id: `${this.estadosConsolidado.opciones.find(
            (estado) => estado.codigo_abreviacion == "DEF"
          )._id
            }`,
          respuesta_decanatura: JSON.stringify({ sec: {}, dec: {} }),
          consolidado_coordinacion: JSON.stringify(consolidado),
          cumple_normativa: false,
          aprobado: false,
          activo: true,
        };

        this.planTrabajoDocenteService.post("consolidado_docente", prepareData).subscribe(
          () => {
            this.popUpManager.showSuccessAlert(
              this.translate.instant("ptd.crear_consolidado_ok")
            );
            this.listarConsolidados();
            this.regresar();
          },
          (err) => {
            console.warn(err);
            this.popUpManager.showErrorAlert(
              this.translate.instant("ptd.fallo_crear_consolidado")
            );
          }
        );
      } catch (error) {
        console.warn(error);
        this.popUpManager.showErrorAlert(
          this.translate.instant("GLOBAL.creacion_documento")
        );
      }
    } else {
      let documentoId = JSON.parse(this.consolidadoInfo.consolidado_coordinacion)
        .documento_id;
      if ((archivo as any)?.file != undefined) {
        try {
          documentoId = await this.subirArchivoSoporte(archivo);
        } catch (error) {
          console.warn(error);
          this.popUpManager.showErrorAlert(
            this.translate.instant("GLOBAL.creacion_documento")
          );
          return;
        }
      }
      const consolidado = {
        documento_id: documentoId,
        responsable_id: responsableId,
      };
      if (this.listaPlanesConsolidado != "") {
        this.consolidadoInfo.plan_docente_id = JSON.stringify(
          this.listaPlanesConsolidado
        );
      }
      this.consolidadoInfo.periodo_id = `${this.periodos.select.Id}`;
      this.consolidadoInfo.proyecto_academico_id = `${this.proyectos.select.Id}`;
      this.consolidadoInfo.estado_consolidado_id = `${this.estadosConsolidado.opciones.find(
        (estado) => estado.codigo_abreviacion == "DEF"
      )._id
        }`;
      this.consolidadoInfo.consolidado_coordinacion = JSON.stringify(consolidado);
      this.planTrabajoDocenteService
        .put(
          "consolidado_docente/" + this.consolidadoInfo._id,
          this.consolidadoInfo
        )
        .subscribe(
          () => {
            this.popUpManager.showSuccessAlert(
              this.translate.instant("ptd.actualizar_consolidado_ok")
            );
            this.listarConsolidados();
            this.regresar();
          },
          (err) => {
            console.warn(err);
            this.popUpManager.showErrorAlert(
              this.translate.instant("ptd.fallo_actualizar_consolidado")
            );
          }
        );
    }
  }

  obtenerDocConsolidado() {
    if (this.periodos.select) {
      this.sgaPlanTrabajoDocenteMidService
        .get(
          `reporte/verificacion-cumplimiento-ptd?vigencia=${this.periodos.select.Id
          }&proyecto=${this.proyectos.select ? this.proyectos.select.Id : 0}`
        )
        .subscribe(
          (resp) => {
            this.listaPlanesConsolidado = resp.Data.listaIdPlanes;
            const pdfBase64 = resp?.Data?.pdf || "";
            if (pdfBase64.trim().length > 0) {
              const rawFilePDF = new Uint8Array(
                atob(pdfBase64)
                  .split("")
                  .map((char) => char.charCodeAt(0))
              );
              const urlFilePDF = window.URL.createObjectURL(
                new Blob([rawFilePDF], { type: "application/pdf" })
              );
              this.previewFile(urlFilePDF);
            } else {
              this.popUpManager.showPopUpGeneric(
                "",
                this.translate.instant("ptd.pdf_solover_excel_imprimir"),
                MODALS.INFO,
                false
              );
            }
            const rawFileExcel = new Uint8Array(
              atob(resp.Data.excel)
                .split("")
                .map((char) => char.charCodeAt(0))
            );
            const urlFileExcel = window.URL.createObjectURL(
              new Blob([rawFileExcel], { type: "application/vnd.ms-excel" })
            );
            const download = document.createElement("a");
            download.href = urlFileExcel;
            download.download = "Consolidado.xlsx";
            document.body.appendChild(download);
            download.click();
            document.body.removeChild(download);
          },
          (err) => {
            this.popUpManager.showPopUpGeneric(
              this.translate.instant("ERROR.titulo_generico"),
              this.translate.instant("ERROR.persiste_error_comunique_OAS"),
              MODALS.ERROR,
              false
            );
            console.warn(err);
          }
        );
    }
  }
  previewFile(url: string) {
    const dialogDoc = new MatDialogConfig();
    dialogDoc.width = "65vw";
    dialogDoc.height = "80vh";
    dialogDoc.data = {
      url: url,
      title: this.translate.instant("GLOBAL.soporte_documental"),
    };
    this.matDialog.open(DialogPreviewFileComponent, dialogDoc);
  }

  verRevDecano(consolidado: any) {
    const respuesta_decanatura = JSON.parse(consolidado.respuesta_decanatura);
    const estado = this.estadosConsolidado.opciones.find(
      (estado) => estado._id == consolidado.estado_consolidado_id
    );
    let Observaciones = "";
    if (Object.keys(respuesta_decanatura.sec).length > 0) {
      Observaciones +=
        "Secretaría Decanatura:\n" +
        respuesta_decanatura.sec.observacion +
        "\n\n";
    }
    if (Object.keys(respuesta_decanatura.dec).length > 0) {
      Observaciones +=
        "Decanatura:\n" + respuesta_decanatura.dec.observacion + "\n";
    }
    this.formRespuestaConsolidado.patchValue({
      Respuesta: estado ? estado.nombre : "Sin Definir",
      Observaciones: Observaciones,
    });
    this.vista = VIEWS.FORM;
    this.respuestaConsolidado = true;
  }
  regresar() {
    this.vista = VIEWS.LIST;
    this.newEditConsolidado = false;
    this.respuestaConsolidado = false;
    this.listarConsolidados();
  }
}
