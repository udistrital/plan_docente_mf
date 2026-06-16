import { AfterViewInit, Component, OnInit, ViewChild } from "@angular/core";
import { TranslateService } from "@ngx-translate/core";
import { PopUpManager } from "src/app/managers/popUpManager";
import { ACTIONS, MODALS, ROLES, VIEWS } from "src/app/models/diccionario";
import { Periodo } from "src/app/models/parametros/periodo";
import { RespFormat } from "src/app/models/response-format";
import { GestorDocumentalService } from "src/app/services/gestor-documental.service";
import { ParametrosService } from "src/app/services/parametros.service";
import { PlanTrabajoDocenteService } from "src/app/services/plan-trabajo-docente.service";
import { SgaPlanTrabajoDocenteMidService } from "src/app/services/sga-plan-trabajo-docente-mid.service";
import { UserService } from "src/app/services/user.service";
import { checkContent, checkResponse } from "src/app/utils/verify-response";
import { MatTableDataSource } from "@angular/material/table";
import { MatPaginator } from "@angular/material/paginator";
import { MatSort } from "@angular/material/sort";
import { MatSelectChange } from "@angular/material/select";
import { EstadoPlan } from "src/app/models/plan-trabajo-docente/estado-plan";
import { cloneDeep as _cloneDeep } from "lodash-es";
import { MatDialog, MatDialogConfig } from "@angular/material/dialog";
import { DialogPreviewFileComponent } from "src/app/dialog-components/dialog-preview-file/dialog-preview-file.component";
import { forkJoin } from "rxjs/internal/observable/forkJoin";
import { firstValueFrom } from "rxjs/internal/firstValueFrom";
import { Observable } from "rxjs/internal/Observable";
import { PermisosUtils } from "src/app/utils/role-permissions";
import { AcademicaJbpmService } from "src/app/services/academica-jbpm.service";
import { TercerosService } from "src/app/services/terceros.service";
import {
  debeValidarHorasSegunRolEnvio,
  validarHorasPlanDocentePorVinculacion,
} from "src/app/utils/ptd-hours";

@Component({
  selector: "app-asignar-ptd",
  templateUrl: "./asignar-ptd.component.html",
  styleUrls: ["./asignar-ptd.component.scss"],
  standalone: false
})
export class AsignarPtdComponent implements OnInit, AfterViewInit {
  readonly VIEWS = VIEWS;
  readonly MODALS = MODALS;
  readonly ACTIONS = ACTIONS;
  vista: Symbol;
  vistaActiva: 'docente' | 'coordinador' = 'docente';

  roles: string[] = [];
  rolVista: string = '';
  canEdit: Symbol = ACTIONS.VIEW;

  opcionesPermisos: string[] = [
    'ver_gestion',
    'editar_gestion',
    'enviar_coordinador',
    'enviar_docente',
    'asignaciones_coordinador',
    'asignaciones_docente',
  ];
  permisos: { [key: string]: boolean } = {};

  periodos: Periodo[] = [];
  periodosFiltrados: Periodo[] = [];
  periodo: Periodo = new Periodo({});
  periodosAnteriores: Periodo[] = [];
  proyectos: any[] = [];
  proyecto: any;
  codigoEventoPTD: string = '';
  calendarEventosPTD: any[] = [];
  calendarEventoSeleccionado: any = null;
  enRangoCalendario: boolean = false;

  estadosPlan: EstadoPlan[] = [];

  dataSource: MatTableDataSource<any>;
  displayedColumns: string[] = [
    "docente",
    "identificacion",
    "tipo_vinculacion",
    "periodo_academico",
    "soporte_documental",
    "gestion",
    "estado",
    "semaforo",
    "enviar",
  ];
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  detallesAsignaciones: any[] = [];

  dataDocente: any = {};
  detalleAsignacion: any = {};
  dataDocentes_ptd: any[] = [];
  detallesGeneral: any = {};
  private proyectosCoordinador: string[] = [];
  private preasignacionesPeriodo: any[] = [];
  documentoDocenteConsulta: string = '';
  terceroIdConsulta: number | null = null;
  hasAttemptedToLoad = false;

  constructor(
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private userService: UserService,
    private sgaPlanTrabajoDocenteMidService: SgaPlanTrabajoDocenteMidService,
    private parametrosService: ParametrosService,
    private planTrabajoDocenteService: PlanTrabajoDocenteService,
    private gestorDocumental: GestorDocumentalService,
    private matDialog: MatDialog,
    private permisosUtils: PermisosUtils,
    private academicaJbpmService: AcademicaJbpmService,
    private tercerosService: TercerosService
  ) {
    this.vista = VIEWS.LIST;
    this.dataSource = new MatTableDataSource();
  }

  async ngOnInit() {
    this.popUpManager.showLoading();
    try {
      // Espera roles
      const roles = await this.userService.getUserRoles();
      this.roles = roles;

      if (!this.roles.includes('ADMIN_SGA')) {
        await this.cargarEventoPTD();
      }
      
      // Construcción observables permisos
      const observables: { [key: string]: Observable<boolean> } = {};
      this.opcionesPermisos.forEach(opcion => {
        observables[opcion] =
          this.permisosUtils.tienePermiso(
            roles,
            opcion
          );

      });
      const resultados = await firstValueFrom(forkJoin(observables));
      this.permisos = resultados;

      if (this.roles.includes('ADMIN_SGA')) {
        this.permisos['asignaciones_coordinador'] = true;
        this.permisos['asignaciones_docente'] = true;
        this.permisos['ver_gestion'] = true;
        this.permisos['editar_gestion'] = false;
        this.permisos['enviar_coordinador'] = false;
        this.permisos['enviar_docente'] = false;
      }

      console.log("Permisos cargados:", this.permisos);

      if (!this.permisos['asignaciones_docente'] && this.permisos['asignaciones_coordinador']) {
        this.vistaActiva = 'coordinador';
      } else {
        this.vistaActiva = 'docente';
      }
      // Cargar proyectos del coordinador si tiene permiso
      if (this.permisos['enviar_coordinador']) {
        this.proyectosCoordinador =
          await this.obtenerProyectosCoordinador();
      }
      // Paralelo porque son independientes
      const [
        periodos,
        estadosPlan
      ] = await Promise.all([
        this.cargarPeriodo(),
        this.cargarEstadosPlan()
        
      ]);
      this.periodos = periodos;
      this.estadosPlan = estadosPlan;
      this.popUpManager.closeLoading();
    } catch (err) {
      this.popUpManager.showErrorAlert(this.translate.instant("ERROR.persiste_error_comunique_OAS"));
    }
  }

  async cargarEventoPTD(): Promise<void> {
    const resp: any = await firstValueFrom(
      this.sgaPlanTrabajoDocenteMidService.get("calendario/eventos")
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
      console.log('--- Asignar PTD: Verificar Rango Fechas ---');
      console.log('Fecha actual:', ahora);
      console.log('Fecha Inicio Evento:', fechaInicio);
      console.log('Fecha Fin Evento:', fechaFin);
      console.log('¿Está en rango?:', this.enRangoCalendario);
    }
  }

  ngAfterViewInit() {
    this.attachPaginatorAndSort();
  }

  private attachPaginatorAndSort() {
    setTimeout(() => {
      if (this.paginator && this.sort) {
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
        this.dataSource.paginator.firstPage();
      }
    }, 100);
  }

  cambiarVista(vista: 'docente' | 'coordinador') {
    this.vistaActiva = vista;
    this.dataSource.filter = '';
    this.dataSource.data = [];
    this.preasignacionesPeriodo = [];
    this.hasAttemptedToLoad = false;

    if (this.periodo?.Id) {
      this.loadAsignaciones();
    }
  }

  esModoLecturaPorCalendario(): boolean {
    if (this.roles.includes('ADMIN_SGA')) {
      return true;
    }
    return !!this.periodo?.Id && !this.enRangoCalendario;
  }

  get displayedColumnsActual(): string[] {
    return this.esModoLecturaPorCalendario()
      ? this.displayedColumns.filter((column) => column !== "enviar")
      : this.displayedColumns;
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  accionSoporte(event: any) {
    if (event.value) {
      this.verPTDFirmado(event.value);
    }
  }

  async accionGestion(event: any) {
    if(this.vistaActiva == 'coordinador'){
      this.rolVista = ROLES.COORDINADOR;
    }else if(this.vistaActiva == 'docente'){
      this.rolVista = ROLES.DOCENTE;
    }
    if (this.esModoLecturaPorCalendario()) {
      this.canEdit = ACTIONS.VIEW;
    } else if (event.rowData.gestion.type == "editar") {
      this.canEdit = ACTIONS.EDIT;
    } else {
      this.canEdit = ACTIONS.VIEW;
    }
    this.popUpManager.showLoading();
    try {
      const res: any = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.get(
          `plan?docente=${event.rowData.docente_id}&vigencia=${event.rowData.periodo_id}&vinculacion=${event.rowData.tipo_vinculacion_id}`
        )
      );
      this.popUpManager.closeLoading();
      this.detalleAsignacion = res.Data;
      this.dataDocente = {
        Nombre: event.rowData.docente,
        NombreCorto:
          res.Data.docente.nombre1 && res.Data.docente.apellido1
            ? res.Data.docente.nombre1 + " " + res.Data.docente.apellido1
            : res.Data.docente.nombre,
        Documento: event.rowData.identificacion,
        Periodo: event.rowData.periodo_academico,
        TipoVinculacion: event.rowData.tipo_vinculacion,
        docente_id: event.rowData.docente_id,
        periodo_id: event.rowData.periodo_id,
        tipo_vinculacion_id: event.rowData.tipo_vinculacion_id,
      };
      this.checknloadRelatedPTD(
        this.detalleAsignacion.planes_relacionados_query
      );
      this.vista = VIEWS.FORM;
          if (this.permisos['ver_gestion']) {
            const modales = [];
            if (this.canEdit == ACTIONS.VIEW) {
              modales.push(this.translate.instant("ptd.info_modo_solo_ver"));
            }
            modales.push(
              this.translate.instant("ptd.aviso_informativo_docente_p1") +
              ".<br><br>" +
              this.translate.instant("ptd.aviso_informativo_docente_p2") +
              "."
            );
            //this.popUpManager.showManyPopUp(this.translate.instant('notas.docente'), modales, MODALS.INFO)
          }
    } catch (error) {
      this.popUpManager.closeLoading();
      console.warn("error:", error);
      this.popUpManager.showErrorToast(this.translate.instant("GLOBAL.error_carga"));
    }
  }

  accionEnviar(event: any) {
    if (this.esModoLecturaPorCalendario()) {
      return;
    }

    const canSendCoordinator = this.permisos['enviar_coordinador'];
    const canSendDocente = this.permisos['enviar_docente'];
    const coordinador = this.esCoordinadorAsignacion;

    if ((coordinador && !canSendCoordinator) || (!coordinador && !canSendDocente)) {
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }

    if (coordinador && !this.tienePendienteEnvioCoordinacion(event?.rowData)) {
      this.popUpManager.showErrorToast(
        this.translate.instant("ptd.no_hay_pendientes_aprobacion_coordinacion")
      );
      return;
    }

    const title = coordinador
      ? this.translate.instant("ptd.enviar_a_docente")
      : this.translate.instant("ptd.mensaje_enviar_a_coordinacion");
    this.popUpManager
      .showPopUpGeneric(
        title,
        this.translate.instant("ptd.pregunta_enviar"),
        MODALS.WARNING,
        false
      )
      .then(async (action) => {
        if (action.value) {
          this.popUpManager.showLoading();
          try {
            await this.enviarSegunRol(
              coordinador,
              event.rowData.plan_docente_id,
              event.rowData
            );
            this.popUpManager.closeLoading();
            await this.popUpManager.showPopUpGeneric(
              this.translate.instant("GLOBAL.operacion_exitosa"),
              this.translate.instant("ptd.plan_enviado_ok"),
              MODALS.SUCCESS,
              false
            );
          } catch (err) {
            this.popUpManager.closeLoading();
            console.warn('Error en enviarSegunRol desde accionEnviar:', err);
            const mensajeError = (err as any)?.message || this.translate.instant("ptd.error_enviar_plan");
            await this.popUpManager.showPopUpGeneric(
              this.translate.instant("GLOBAL.error"),
              mensajeError,
              MODALS.ERROR,
              false
            );
          }
        }
      });
  }

  checknloadRelatedPTD(otherPTD: string[]): void {
    this.detallesAsignaciones = [];
    this.dataDocentes_ptd = [];
    this.detallesGeneral = undefined;

    // Cláusula de guarda: Si no hay elementos, terminamos temprano
    if (!otherPTD || otherPTD.length === 0) return;

    this.inicializarDetallesGeneral();

    // Iterar y consultar de manera limpia delegando la lógica interna
    otherPTD.forEach((doc_per_vinc) => {
      this.sgaPlanTrabajoDocenteMidService
        .get(`plan/${doc_per_vinc}`)
        .subscribe({
          next: (res: any) => this.procesarRespuestaPTD(res.Data),
          error: (err: any) => console.warn(doc_per_vinc, err)
        });
    });
  }

  /**
   * Inicializa y clona las estructuras del docente principal
   */
  private inicializarDetallesGeneral(): void {
    this.detallesGeneral = <any>_cloneDeep(this.detalleAsignacion);
    this.detallesGeneral.docentesModular = {};
    this.detallesGeneral.docentesModular[this.dataDocente.docente_id] = this.dataDocente;

    // Mantener la carga del docente principal
    this.detallesGeneral.carga[0] = this.detallesGeneral.carga[0].map((c: any) => ({
      ...c,
      docente_id: this.dataDocente.docente_id,
      modular: false,
    }));
  }

  /**
   * Coordina la inyección de los datos del docente relacionado dentro del flujo general
   */
  private procesarRespuestaPTD(planData: any): void {
    this.detallesAsignaciones.push(planData);

    const datathisDocente = this.construirDataDocente(planData);
    this.dataDocentes_ptd.push(datathisDocente);

    // Procesar cargas y espacios académicos usando filtros semánticos
    this.integrarCargasCompartidas(planData.carga[0], datathisDocente.docente_id);
    this.integrarEspaciosCompartidos(planData.espacios_academicos[0], datathisDocente.docente_id);

    this.detallesGeneral.docentesModular[datathisDocente.docente_id] = datathisDocente;
  }

  /**
   * Mapea y formatea la información del docente relacionado
   */
  private construirDataDocente(planData: any): any {
    const nombreCorto = planData.docente.nombre1 && planData.docente.apellido1
      ? `${planData.docente.nombre1} ${planData.docente.apellido1}`
      : planData.docente.nombre;

    return {
      Nombre: planData.docente.nombre,
      NombreCorto: nombreCorto,
      Documento: planData.docente.identificacion,
      Periodo: planData.periodo_academico,
      TipoVinculacion: planData.tipo_vinculacion[0].nombre,
      docente_id: planData.docente.id,
      periodo_id: planData.vigencia,
      tipo_vinculacion_id: planData.tipo_vinculacion[0].id,
    };
  }

  /**
   * Añade la carga del otro docente solo si la materia es compartida con el docente principal
   */
  private integrarCargasCompartidas(cargasOrigen: any[], docenteId: string): void {
    const relatedCarga = <any[]>_cloneDeep(cargasOrigen);

    relatedCarga.forEach((carga) => {
      const esCompartida = this.detallesGeneral.espacios_academicos[0].some(
        (ea: any) => ea.id === carga.espacio_academico_id
      );

      if (esCompartida) {
        this.detallesGeneral.carga[0].push({
          ...carga,
          docente_id: docenteId,
          modular: true,
        });
      }
    });
  }

  /**
   * Añade los espacios académicos del otro docente solo si la materia es compartida con el docente principal
   */
  private integrarEspaciosCompartidos(espaciosOrigen: any[], docenteId: string): void {
    espaciosOrigen.forEach((ea: any) => {
      const esCompartido = this.detallesGeneral.espacios_academicos[0].some(
        (eaGeneral: any) => eaGeneral.espacio_academico === ea.espacio_academico
      );

      if (esCompartido) {
        this.detallesGeneral.espacios_academicos[0].push({
          ...ea,
          docente_id: docenteId,
          modular: true,
        });
      }
    });
  }

  async loadAsignaciones(): Promise<void> {
    this.dataSource.filter = '';

    // 1. Caso: Sin permisos o sin vista válida
    if (this.vistaActiva === 'coordinador' && !this.permisos['asignaciones_coordinador']) {
      this.manejarAccesoDenegado();
      return;
    }
    if (this.vistaActiva === 'docente' && !this.permisos['asignaciones_docente']) {
      this.manejarAccesoDenegado();
      return;
    }
    if (this.vistaActiva !== 'coordinador' && this.vistaActiva !== 'docente') {
      this.manejarAccesoDenegado();
      return;
    }

    try {
      let url = "";

      if (this.vistaActiva === 'coordinador') {
        url = `asignacion?vigencia=${this.periodo.Id}`;
        if (this.proyecto?.Id && !this.roles.includes(ROLES.DOCENTE)) {
          url += `&proyecto=${this.proyecto.Id}`;
        }

        const resp = await firstValueFrom(this.sgaPlanTrabajoDocenteMidService.get(url));
        
        if (checkResponse(resp) && checkContent(resp)) {
          const preasignaciones = await this.cargarPreasignacionesPeriodo();
          this.preasignacionesPeriodo = preasignaciones;

          const modoLectura = this.esModoLecturaPorCalendario();
          const data = (resp.Data || []).map((row: any) => {
            const semaforo = this.getSemaforoAsignacion(row, preasignaciones);
            const enviar = this.construirAccionEnviar(row, preasignaciones);
            const estado = row?.estado ? row.estado.toString().toLowerCase() : "";
            const isNoAprobado = estado.includes("no aprobado");

            if (modoLectura && row.gestion) {
              return { ...row, gestion: { ...row.gestion, type: "ver" }, semaforo, enviar };
            }

            if (this.permisos['ver_gestion'] && (isNoAprobado || row.estado === "Enviado a docente") && row.gestion) {
              return { ...row, gestion: { ...row.gestion, type: "ver" }, semaforo, enviar };
            }
            return { ...row, semaforo, enviar };
          });

          this.dataSource = new MatTableDataSource(data);
        } else {
          this.manejarErrorCarga();
        }

      } else if (this.vistaActiva === 'docente') {
        let id_tercero: number;
        if (this.roles.includes('ADMIN_SGA')) {
          if (!this.terceroIdConsulta) {
            this.popUpManager.showErrorToast(this.translate.instant("ptd.error_doc_docente"));
            return;
          }
          id_tercero = this.terceroIdConsulta;
        } else {
          id_tercero = await this.userService.getPersonaId();
        }
        
        url = `asignacion/docente?docente=${id_tercero}&vigencia=${this.periodo.Id}`;
        if (this.proyecto?.Id && !this.roles.includes(ROLES.DOCENTE)) {
          url += `&proyecto=${this.proyecto.Id}`;
        }

        const resp = await firstValueFrom(this.sgaPlanTrabajoDocenteMidService.get(url));

        if (checkResponse(resp) && checkContent(resp)) {
          const modoLectura = this.esModoLecturaPorCalendario();
          const data = (resp.Data || []).map((row: any) => {
            const semaforo = this.getSemaforoAsignacion(row);
            const enviar = this.construirAccionEnviar(row);
            const estado = row?.estado ? row.estado.toString().toLowerCase() : "";
            const isNoAprobado = estado.includes("no aprobado");

            if (modoLectura && row.gestion) {
              return { ...row, gestion: { ...row.gestion, type: "ver" }, semaforo, enviar };
            }

            if (this.permisos['ver_gestion'] && isNoAprobado && row.gestion) {
              return { ...row, gestion: { ...row.gestion, type: "ver" }, semaforo, enviar };
            }
            return { ...row, semaforo, enviar };
          });

          this.dataSource = new MatTableDataSource(data);
        } else {
          this.manejarErrorCarga();
        }
      }

    } catch (err) {
      // Captura tanto errores de HTTP (get) como del userService
      this.dataSource = new MatTableDataSource();
      const mensajeError = this.vistaActiva === 'docente' && !this.dataSource.data.length
        ? "GLOBAL.error_no_found_tercero_id"
        : "ptd.error_no_found_asignaciones";
      
      this.popUpManager.showErrorAlert(this.translate.instant(mensajeError));
    } finally {
      this.hasAttemptedToLoad = true;
      this.attachPaginatorAndSort();
    }
  }

  // Métodos auxiliares privados para mantener DRY (Clean Code)
  private manejarAccesoDenegado(): void {
    this.dataSource = new MatTableDataSource();
    this.popUpManager.showErrorAlert(this.translate.instant('GLOBAL.acceso_denegado'));
    this.attachPaginatorAndSort();
  }

  private manejarErrorCarga(): void {
    this.dataSource = new MatTableDataSource();
    this.popUpManager.showErrorAlert(this.translate.instant("ptd.error_no_found_asignaciones"));
  }

  get esCoordinadorAsignacion(): boolean {
    return this.vistaActiva === 'coordinador' && !!this.permisos['asignaciones_coordinador'];
  }

  getSemaforoAsignacion(row: any, preasignaciones: any[] = []): { color: string; tooltip: string; icon: string } {
    if (!this.esCoordinadorAsignacion) {
      return this.getSemaforoEstado(row?.estado, row?.tiene_observaciones);
    }

    const preasignacionesRelacionadas = this.obtenerPreasignacionesRelacionadas(row, preasignaciones);

    if (preasignacionesRelacionadas.length === 0) {
      return {
        color: "#F44336",
        tooltip: this.translate.instant("ptd.semaforo_preasignacion_pendiente_docente"),
        icon: "cancel",
      };
    }

    const total = preasignacionesRelacionadas.length;
    const aprobadasDocente = preasignacionesRelacionadas.filter((preasignacion) =>
      this.getValorAprobacion(preasignacion?.aprobacion_docente)
    ).length;
    const aprobadasCoordinacion = preasignacionesRelacionadas.filter((preasignacion) =>
      this.getValorAprobacion(preasignacion?.aprobacion_proyecto)
    ).length;

    if (aprobadasDocente === total && aprobadasCoordinacion === total) {
      return {
        color: "#4CAF50",
        tooltip: this.translate.instant("ptd.semaforo_preasignacion_aprobada"),
        icon: "check_circle",
      };
    }

    if (aprobadasDocente === total && aprobadasCoordinacion < total) {
      return {
        color: "#FFC107",
        tooltip: this.translate.instant("ptd.semaforo_preasignacion_pendiente_coordinacion"),
        icon: "autorenew",
      };
    }

    return {
      color: "#F44336",
      tooltip: this.translate.instant("ptd.semaforo_preasignacion_pendiente_docente"),
      icon: "cancel",
    };
  }

  private construirAccionEnviar(row: any, preasignaciones: any[] = []): { value: any; type: string; disabled: boolean } {
    const accion = row?.enviar && typeof row.enviar === "object"
      ? { ...row.enviar }
      : { value: undefined, type: "enviar" };

    accion.type = accion.type || "enviar";

    if (this.esCoordinadorAsignacion) {
      accion.disabled = !this.permisos['enviar_coordinador'] || !this.tienePendienteEnvioCoordinacion(row, preasignaciones);
    } else if (typeof accion.disabled !== "boolean") {
      accion.disabled = !this.permisos['enviar_docente'];
    }

    return accion;
  }

  private tienePendienteEnvioCoordinacion(row: any, preasignaciones: any[] = this.preasignacionesPeriodo): boolean {
    const preasignacionesRelacionadas = this.obtenerPreasignacionesRelacionadas(row, preasignaciones);
    if (preasignacionesRelacionadas.length === 0) {
      return false;
    }

    const total = preasignacionesRelacionadas.length;
    const aprobadasDocente = preasignacionesRelacionadas.filter((preasignacion) =>
      this.getValorAprobacion(preasignacion?.aprobacion_docente)
    ).length;
    const aprobadasCoordinacion = preasignacionesRelacionadas.filter((preasignacion) =>
      this.getValorAprobacion(preasignacion?.aprobacion_proyecto)
    ).length;

    return aprobadasDocente === total && aprobadasCoordinacion < total;
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

  cargarPeriodosAnteriores(periodo: Periodo) {
    this.periodosAnteriores = this.periodos.filter((porPeriodo) => {
      if (
        porPeriodo.Year <= periodo.Year &&
        porPeriodo.Id < periodo.Id &&
        porPeriodo.Nombre < periodo.Nombre
      ) {
        return porPeriodo;
      } else {
        return false;
      }
    });
  }

  selectProyecto(proyecto: any) {
    this.proyecto = proyecto.value;
    this.periodo = new Periodo({});
    this.periodosFiltrados = [];
    this.dataSource = new MatTableDataSource();
    this.preasignacionesPeriodo = [];
    this.dataSource.filter = '';
    this.hasAttemptedToLoad = false;
    if (this.proyecto) {
      this.filtrarPeriodosPorCalendario();
    }
  }

  async selectPeriodo(event: MatSelectChange): Promise<void> {
    this.periodo = event.value;
    this.dataSource = new MatTableDataSource();
    this.preasignacionesPeriodo = [];
    this.dataSource.filter = '';
    this.hasAttemptedToLoad = false;

    if (!this.periodo?.Id) {
      return;
    }

    this.cargarPeriodosAnteriores(this.periodo);
    this.verificarRangoFechas();

    this.popUpManager.showLoading();

    try {
      // El hilo se detiene aquí de verdad hasta que la API responda
      await this.loadAsignaciones();
    } catch (err) {
      console.warn('Error en loadAsignaciones desde selectPeriodo:', err);
      this.popUpManager.showErrorToast(
        this.translate.instant("ERROR.persiste_error_comunique_OAS")
      );
    } finally {
      // El spinner solo se cerrará CUANDO los datos ya estén en la tabla (o falle)
      this.popUpManager.closeLoading();
    }
  }

  async procesarDocumentoSuperusuario() {
    if (!this.documentoDocenteConsulta) {
      this.proyectos = [];
      this.periodosFiltrados = [];
      this.dataSource.data = [];
      this.terceroIdConsulta = null;
      this.proyectosCoordinador = [];
      return;
    }

    this.popUpManager.showLoading();
    try {
      // 1. Resolve TerceroId
      const queryUrl = `datos_identificacion?query=Activo:true,Numero:${this.documentoDocenteConsulta}&sortby=FechaCreacion&order=desc`;
      const respTercero = await firstValueFrom(this.tercerosService.get(queryUrl));
      const dataTercero = respTercero?.Data ?? respTercero ?? [];
      if (!Array.isArray(dataTercero) || dataTercero.length === 0 || !dataTercero[0]?.TerceroId?.Id) {
        this.popUpManager.showErrorToast(this.translate.instant("ptd.error_no_found_docente"));
        this.proyectos = [];
        this.periodosFiltrados = [];
        this.dataSource.data = [];
        this.terceroIdConsulta = null;
        this.proyectosCoordinador = [];
        return;
      }
      this.terceroIdConsulta = dataTercero[0].TerceroId.Id;

      // 2. Load coordinator projects if applicable
      try {
        this.proyectosCoordinador = await this.obtenerProyectosCoordinador();
      } catch (e) {
        console.warn("Could not retrieve coordinator projects:", e);
        this.proyectosCoordinador = [];
      }

      // 3. Load calendar events and projects for this teacher's document
      await this.cargarEventoPTD();
      
      this.proyecto = null;
      this.periodo = new Periodo({});
      this.periodosFiltrados = [];
      this.dataSource.data = [];
      this.hasAttemptedToLoad = false;
    } catch (err) {
      console.error(err);
      this.popUpManager.showErrorToast(this.translate.instant("ERROR.persiste_error_comunique_OAS"));
    } finally {
      this.popUpManager.closeLoading();
    }
  }

  cargarEstadosPlan(): Promise<EstadoPlan[]> {
    return new Promise((resolve, reject) => {
      this.planTrabajoDocenteService
        .get("estado_plan?query=activo:true&limit=0")
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

  async enviarSegunRol(coordinador: boolean, id_plan: string, rowData?: any): Promise<void> {
    const cod_abrev = coordinador ? "ENV_COO" : "ENV_DOC";
    const estado = this.estadosPlan.find(
      (estado) => estado.codigo_abreviacion === cod_abrev
    );
    if (!estado) {
      throw new Error(this.translate.instant("ptd.error_enviar_plan"));
    }

    const res_g: any = await firstValueFrom(
      this.planTrabajoDocenteService.get("plan_docente/" + id_plan)
    );

    const validacionFila = validarHorasPlanDocentePorVinculacion(
      null,
      String(rowData?.tipo_vinculacion || "").trim()
    );
    const vinculacionSinNoLectivas = validacionFila.registraHorasNoLectivas === false;
    const debeValidarHoras = vinculacionSinNoLectivas || debeValidarHorasSegunRolEnvio(
      validacionFila.registraHorasNoLectivas,
      coordinador
    );

    if (debeValidarHoras) {
      let planToValidate: any = null;
      try {
        const planResp: any = await firstValueFrom(
          this.sgaPlanTrabajoDocenteMidService.get(
            `plan?docente=${rowData?.docente_id}&vigencia=${rowData?.periodo_id}&vinculacion=${rowData?.tipo_vinculacion_id}`
          )
        );
        planToValidate = planResp?.Data;
      } catch (error) {
        console.warn("No fue posible cargar el plan para validación de horas", error);
        throw new Error(this.translate.instant("ptd.error_validacion_horas_cargar_plan"));
      }

      if (!planToValidate) {
        throw new Error(this.translate.instant("ptd.error_validacion_horas_plan_no_encontrado"));
      }

      const codigoAbreviacionFila =
        validacionFila.codigoAbreviacion ||
        String(rowData?.tipo_vinculacion || "").trim();
      const validacionHoras = validarHorasPlanDocentePorVinculacion(
        planToValidate,
        codigoAbreviacionFila
      );
      if (
        !validacionHoras.codigoAbreviacion ||
        validacionHoras.horasMaximas === null ||
        validacionHoras.estaEnRango === null
      ) {
        throw new Error(this.translate.instant("ptd.error_validacion_horas_tipo_vinculacion"));
      }

      if (!validacionHoras.estaEnRango) {
        if (vinculacionSinNoLectivas && validacionHoras.totalHoras > validacionHoras.horasMaximas) {
          throw new Error(
            this.translate.instant("ptd.error_validacion_horas_total_plan", {
              horasRequeridas: validacionHoras.horasMaximas,
              totalHoras: validacionHoras.totalHoras,
            })
          );
        }

        if (
          validacionHoras.horasMinimas !== null &&
          validacionHoras.horasMinimas !== validacionHoras.horasMaximas
        ) {
          throw new Error(
            this.translate.instant("ptd.error_validacion_horas_rango_plan", {
              horasMinimas: validacionHoras.horasMinimas,
              horasMaximas: validacionHoras.horasMaximas,
              totalHoras: validacionHoras.totalHoras,
            })
          );
        }

        throw new Error(
          this.translate.instant("ptd.error_validacion_horas_total_plan", {
            horasRequeridas: validacionHoras.horasMaximas,
            totalHoras: validacionHoras.totalHoras,
          })
        );
      }
    }

    if (coordinador) {
      const cargaAutomaticaOk = await this.persistirCargaAutomaticaDesdePreasignacion(
        rowData,
        id_plan,
        res_g?.Data
      );
      if (!cargaAutomaticaOk) {
        throw new Error(this.translate.instant("ptd.error_enviar_plan"));
      }
    }

    if (!coordinador) {
      const respuestaJson = res_g.Data.respuesta ? JSON.parse(res_g.Data.respuesta) : {};
      respuestaJson["DocenteAprueba"] = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
      res_g.Data.respuesta = JSON.stringify(respuestaJson);
    }
    res_g.Data.estado_plan_id = estado._id;

    await firstValueFrom(
      this.planTrabajoDocenteService.put("plan_docente/" + id_plan, res_g.Data)
    );

    if (coordinador) {
      const preasignacionesActualizadas = await this.marcarPreasignacionesComoAprobadasPorCoordinacion(rowData);
      if (!preasignacionesActualizadas) {
        throw new Error(this.translate.instant("ptd.error_enviar_plan"));
      }
    }

    // Se esperará de manera síncrona real a que termine la carga de datos.
    await this.loadAsignaciones();
  }

  private async persistirCargaAutomaticaDesdePreasignacion(
    rowData: any,
    planId: string,
    planDocenteActual: any
  ): Promise<boolean> {
    if (!rowData?.docente_id || !rowData?.periodo_id || !rowData?.tipo_vinculacion_id) {
      return true;
    }

    try {
      const planResp: any = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.get(
          `plan?docente=${rowData.docente_id}&vigencia=${rowData.periodo_id}&vinculacion=${rowData.tipo_vinculacion_id}`
        )
      );

      const dataPlan = planResp?.Data;
      const seleccion = Number(dataPlan?.seleccion || 0);
      const espacios = Array.isArray(dataPlan?.espacios_academicos?.[seleccion])
        ? dataPlan.espacios_academicos[seleccion]
        : [];
      const cargaActual = Array.isArray(dataPlan?.carga?.[seleccion])
        ? dataPlan.carga[seleccion]
        : [];

      if (!espacios.length) {
        return true;
      }

      // Filtrar espacios por proyecto del coordinador si aplica
      const espaciosFiltrarados = this.esCoordinadorAsignacion
        ? this.filtrarEspaciosPorProyectoCoordinador(espacios)
        : espacios;

      if (espaciosFiltrarados.length !== espacios.length && this.esCoordinadorAsignacion) {
        const espaciosFueraProyecto = espacios.filter(
          e => !espaciosFiltrarados.some(
            ef => (ef.id || ef._id) === (e.id || e._id)
          )
        );

        if (espaciosFueraProyecto.length > 0) {
          const nombresFuera = espaciosFueraProyecto
            .map(e => `• ${e.espacio_academico || e.nombre}`)
            .join("<br>");

          this.popUpManager.showPopUpGeneric(
            this.translate.instant("ptd.carga_automatica_parcial"),
            `${this.translate.instant("ptd.espacios_fuera_proyecto_coordinador")}<br><br>${nombresFuera}`,
            MODALS.INFO,
            false
          );
        }
      }

      const espaciosConCarga = new Set(
        cargaActual
          .map((c: any) => String(c?.espacio_academico_id || "").trim())
          .filter((id: string) => !!id && id !== "NA")
      );

      // Usar espacios filtrados
      const espaciosParaProcesar = espaciosFiltrarados;

      const periodoAcademico = String(
        dataPlan?.periodo_academico || rowData?.periodo_academico || ""
      ).trim();
      const partesPeriodo = periodoAcademico.split("-");
      const anio = (partesPeriodo[0] || "").trim();
      const periodo = (partesPeriodo[1] || "").trim();

      if (!anio || !periodo) {
        return true;
      }

      const cargasNuevas: any[] = [];
      const espaciosObjetivoIds = Array.from(
        new Set(
          espaciosParaProcesar
            .map((espacio: any) => String(espacio?.id || espacio?._id || "").trim())
            .filter((id: string) => !!id)
        )
      );

      for (const espacio of espaciosParaProcesar) {
        const espacioAcademicoId = String(espacio?.id || espacio?._id || "").trim();
        const codigo = String(
          espacio?.codigo || espacio?.CodigoEspacioAcademico || ""
        ).trim();
        const grupo = String(espacio?.grupo || espacio?.Grupo || "").trim();

        if (!espacioAcademicoId || !codigo || !grupo) {
          continue;
        }

        if (espaciosConCarga.has(espacioAcademicoId)) {
          continue;
        }

        const horariosResp: any = await firstValueFrom(
          this.sgaPlanTrabajoDocenteMidService.get(
            `espacio-academico/informacion-horarios/${anio}/${periodo}/${codigo}/${grupo}`
          )
        );

        const colocaciones = (Array.isArray(horariosResp?.Data)
          ? horariosResp.Data
          : []).filter((item: any) => !item?.Docente);

        if (!colocaciones.length) {
          continue;
        }
        colocaciones.forEach((colocacion: any) => {
          const horario =
            colocacion?.ResumenColocacionEspacioFisico?.colocacion || {};
          const espacioFisico =
            colocacion?.ResumenColocacionEspacioFisico?.espacio_fisico || {};

          const sedeId = this.obtenerIdNumericoEspacioFisico(
            espacioFisico,
            "sede"
          );
          const edificioId = this.obtenerIdNumericoEspacioFisico(
            espacioFisico,
            "edificio"
          );
          const salonId = this.obtenerIdNumericoEspacioFisico(
            espacioFisico,
            "salon"
          );

          const horaInicio = parseInt(
            String(horario?.horaFormato || "0").split(":")[0],
            10
          );

          cargasNuevas.push({
            id: "colocacionModuloHorario",
            espacio_academico_id: espacioAcademicoId,
            espacio_academico_nombre: String(
              espacio?.espacio_academico || espacio?.nombre || ""
            ),
            actividad_id: "NA",
            plan_docente_id: planId,
            colocacion_id: "",
            hora_inicio: Number.isNaN(horaInicio) ? 0 : horaInicio,
            duracion: Number(horario?.horas || 0),
            salon_id: salonId,
            edificio_id: edificioId,
            sede_id: sedeId,
            horario: {
              horas: Number(horario?.horas || 0),
              horaFormato: String(horario?.horaFormato || ""),
              tipo: Number(horario?.tipo || 1),
              estado: Number(horario?.estado || 2),
              dragPosition: horario?.dragPosition || { x: 0, y: 0 },
              prevPosition: horario?.prevPosition || { x: 0, y: 0 },
              finalPosition: horario?.finalPosition || { x: 0, y: 0 },
            },
            periodo_id: String(rowData.periodo_id),
            activo: true,
          });
        });
      }

      const espaciosAprobadosIds = Array.from(
        new Set(
          [
            ...cargaActual
              .map((c: any) => String(c?.espacio_academico_id || "").trim())
              .filter((id: string) => !!id && id !== "NA"),
            ...cargasNuevas
              .map((c: any) => String(c?.espacio_academico_id || "").trim())
              .filter((id: string) => !!id && id !== "NA"),
          ].filter((id: string) => espaciosObjetivoIds.includes(id))
        )
      );

      if (!cargasNuevas.length) {
        const preasignacionesActualizadas = await this.marcarPreasignacionesComoAprobadasPorCoordinacion(
          rowData,
          espaciosAprobadosIds
        );

        return preasignacionesActualizadas;
      }

      const materiasConCruce = this.obtenerMateriasConCruceHorario(
        cargaActual,
        cargasNuevas,
        espacios
      );

      if (materiasConCruce.length > 0) {
        const detalleCruces = materiasConCruce
          .map((materia) =>
            `Conflicto de Horario: El espacio académico ${materia.nombre} presenta cruce en ${materia.bloqueHorario}.`
          )
          .join("<br>");

        throw new Error(detalleCruces);
      }

      this.validarTopeHorasAntesDePersistirCarga(dataPlan, rowData, cargasNuevas);

      const resumenActual = planDocenteActual?.resumen
        ? planDocenteActual.resumen
        : JSON.stringify({});

      const estadoActual =
        planDocenteActual?.estado_plan_id || dataPlan?.estado_plan?.[seleccion] || "Sin definir";

      try {
        await firstValueFrom(
          this.sgaPlanTrabajoDocenteMidService.put("plan/", {
            carga_plan: cargasNuevas,
            plan_docente: {
              id: planId,
              resumen: resumenActual,
              estado_plan: estadoActual,
            },
            descartar: [],
          })
        );
      } catch (error: any) {
        const conflictosBackend = this.extraerConflictosCruce(error);
        if (conflictosBackend.length > 0) {
          throw new Error(this.construirMensajeDetalladoCruces(conflictosBackend));
        }
        throw error;
      }

      const preasignacionesActualizadas = await this.marcarPreasignacionesComoAprobadasPorCoordinacion(
        rowData,
        espaciosAprobadosIds
      );

      if (!preasignacionesActualizadas) {
        return false;
      }

      return true;
    } catch (error: any) {
      if (error instanceof Error && error.message) {
        throw error;
      }
      console.warn("No fue posible persistir carga automática desde preasignación", error);
      return false;
    }
  }

  private extraerConflictosCruce(error: any): any[] {
    const conflictos = error?.error?.Data;
    return Array.isArray(conflictos) ? conflictos : [];
  }

  private validarTopeHorasAntesDePersistirCarga(
    dataPlan: any,
    rowData: any,
    cargasNuevas: any[]
  ): void {
    const validacionHoras = validarHorasPlanDocentePorVinculacion(
      dataPlan,
      String(rowData?.tipo_vinculacion || "").trim()
    );

    if (!validacionHoras.codigoAbreviacion || validacionHoras.horasMaximas === null) {
      throw new Error(this.translate.instant("ptd.error_validacion_horas_tipo_vinculacion"));
    }

    const horasNuevas = (cargasNuevas || []).reduce((acumulado: number, carga: any) => {
      const horas = Number(carga?.horario?.horas ?? carga?.duracion ?? 0);
      return acumulado + (Number.isNaN(horas) ? 0 : horas);
    }, 0);

    const totalHorasProyectado = validacionHoras.totalHoras + horasNuevas;
    if (totalHorasProyectado > validacionHoras.horasMaximas) {
      throw new Error(
        this.translate.instant("ptd.error_validacion_horas_total_plan", {
          horasRequeridas: validacionHoras.horasMaximas,
          totalHoras: totalHorasProyectado,
        })
      );
    }
  }

  private construirMensajeDetalladoCruces(conflictos: any[]): string {
    return conflictos
      .map((conflicto: any) => {
        const espacioA = String(conflicto?.espacio_a || "").trim();
        const espacioB = String(conflicto?.espacio_b || "").trim();
        const dia = String(conflicto?.dia || "").trim();
        const horaInicio = String(conflicto?.hora_inicio || "").trim();
        const horaFin = String(conflicto?.hora_fin || "").trim();
        const franja = `${horaInicio} - ${horaFin}`;

        return `Conflicto de Horario: El espacio académico ${espacioA} se cruza con ${espacioB} el día ${dia} en la franja ${franja}.`;
      })
      .join("<br>");
  }

  private async marcarPreasignacionesComoAprobadasPorCoordinacion(rowData: any, espaciosAprobadosIds: string[] = []): Promise<boolean> {
    if (!rowData?.docente_id || !rowData?.periodo_id || !rowData?.tipo_vinculacion_id) {
      return true;
    }

    try {
      const preasignacionesResp: any = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.get(`preasignacion?vigencia=${rowData.periodo_id}`)
      );

      const preasignaciones = Array.isArray(preasignacionesResp?.Data)
        ? preasignacionesResp.Data
        : [];

      const preasignacionesElegibles = preasignaciones
        .filter((preasignacion: any) =>
          String(preasignacion?.docente_id || "").trim() === String(rowData.docente_id || "").trim() &&
          String(preasignacion?.periodo_id || "").trim() === String(rowData.periodo_id || "").trim() &&
          String(preasignacion?.tipo_vinculacion_id || "").trim() === String(rowData.tipo_vinculacion_id || "").trim() &&
          this.getValorAprobacion(preasignacion?.aprobacion_docente) &&
          !this.getValorAprobacion(preasignacion?.aprobacion_proyecto) &&
          !!String(preasignacion?.espacio_academico_id || preasignacion?.espacio_academico || "").trim()
        )
        .map((preasignacion: any) => ({
          id: preasignacion?.id || preasignacion?._id,
          espacioAcademicoId: String(
            preasignacion?.espacio_academico_id || preasignacion?.espacio_academico || ""
          ).trim(),
        }))
        .filter((preasignacion: any) => !!String(preasignacion.id || "").trim());

      const idsPreasignaciones = preasignacionesElegibles
        .filter((preasignacion: any) =>
          espaciosAprobadosIds.includes(preasignacion.espacioAcademicoId)
        )
        .map((preasignacion: any) => ({
          Id: preasignacion.id,
        }))
        .filter((preasignacion: any) => !!String(preasignacion.Id || "").trim());

      const idsNoPreasignaciones = preasignacionesElegibles
        .filter((preasignacion: any) => !espaciosAprobadosIds.includes(preasignacion.espacioAcademicoId))
        .map((preasignacion: any) => ({
          Id: preasignacion.id,
        }))
        .filter((preasignacion: any) => !!String(preasignacion.Id || "").trim());

      if (!idsPreasignaciones.length) {
        return true;
      }

      const respAprobacion: RespFormat = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.put("preasignacion/aprobar", {
          preasignaciones: idsPreasignaciones,
          "no-preasignaciones": idsNoPreasignaciones,
          docente: false,
        })
      );

      return checkResponse(respAprobacion);
    } catch (error) {
      console.warn("No fue posible actualizar la preasignación desde la asignación", error);
      return false;
    }
  }

  private obtenerIdNumericoEspacioFisico(
    espacioFisico: any,
    tipo: "sede" | "edificio" | "salon"
  ): string {
    const entidad = espacioFisico?.[tipo] || {};
    const idEntidad =
      entidad?.Id ?? entidad?.id ?? entidad?._id ?? entidad?.ID ?? null;
    const idDirecto =
      espacioFisico?.[`${tipo}_id`] || espacioFisico?.[`${tipo}Id`] || null;

    const normalizar = (valor: any): string => {
      const texto = String(valor ?? "").trim();
      if (!texto) {
        return "NA";
      }
      return /^\d+$/.test(texto) ? texto : "NA";
    };

    const idNormalizadoEntidad = normalizar(idEntidad);
    if (idNormalizadoEntidad !== "NA") {
      return idNormalizadoEntidad;
    }

    const idNormalizadoDirecto = normalizar(idDirecto);
    if (idNormalizadoDirecto !== "NA") {
      return idNormalizadoDirecto;
    }

    return "NA";
  }

  private getValorAprobacion(approval: any): boolean {
    if (typeof approval === "boolean") {
      return approval;
    }

    if (approval && typeof approval === "object" && "value" in approval) {
      return !!approval.value;
    }

    return false;
  }

  private obtenerDocumentoCoordinador(): string | null {
    if (this.roles.includes('ADMIN_SGA')) {
      return this.documentoDocenteConsulta || null;
    }
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

  private async cargarPreasignacionesPeriodo(): Promise<any[]> {
    if (!this.esCoordinadorAsignacion || !this.periodo?.Id) {
      this.preasignacionesPeriodo = [];
      return [];
    }

    try {
      const resp: any = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.get(`preasignacion?vigencia=${this.periodo.Id}`)
      );

      const preasignaciones = Array.isArray(resp?.Data) ? resp.Data : [];
      if (!this.proyecto?.Id) {
        this.preasignacionesPeriodo = preasignaciones;
        return preasignaciones;
      }

      const filtradas = preasignaciones.filter((item: any) =>
        String(item?.codigo_proyecto_academico || "").trim() === String(this.proyecto.Id).trim()
      );

      this.preasignacionesPeriodo = filtradas;
      return filtradas;
    } catch (error) {
      console.warn("No fue posible cargar las preasignaciones del periodo", error);
      this.preasignacionesPeriodo = [];
      return [];
    }
  }

  private obtenerPreasignacionesRelacionadas(row: any, preasignaciones: any[]): any[] {
    if (!row) {
      return [];
    }

    const docenteId = String(row?.docente_id || "").trim();
    const periodoId = String(row?.periodo_id || "").trim();
    const tipoVinculacionId = String(row?.tipo_vinculacion_id || "").trim();

    if (!docenteId || !periodoId || !tipoVinculacionId) {
      return [];
    }

    return (preasignaciones || []).filter((preasignacion: any) => {
      const coincideProyecto = !this.proyecto?.Id ||
        String(preasignacion?.codigo_proyecto_academico || "").trim() === String(this.proyecto.Id).trim();

      return coincideProyecto &&
        String(preasignacion?.docente_id || "").trim() === docenteId &&
        String(preasignacion?.periodo_id || "").trim() === periodoId &&
        String(preasignacion?.tipo_vinculacion_id || "").trim() === tipoVinculacionId;
    });
  }

  private obtenerProyectosCoordinador(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const documentoCoordinador = this.obtenerDocumentoCoordinador();
      if (!documentoCoordinador) {
        reject(new Error("No fue posible obtener el documento del coordinador"));
        return;
      }
      this.academicaJbpmService.get(`coordinador_usuario/${documentoCoordinador}`).subscribe({
        next: (resp: any) => {
          if (Array.isArray(resp.coordinadores.coordinador)) {
            const codigos = resp.coordinadores.coordinador.map((c: any) => String(c.codigo_carrera || "").trim());
            resolve(codigos.filter((c: string) => !!c));
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

  private filtrarEspaciosPorProyectoCoordinador(espacios: any[]): any[] {
    if (!this.proyectosCoordinador || this.proyectosCoordinador.length === 0) {
      return espacios;
    }

    return espacios.filter((espacio: any) => {
      const proyectoId = String(espacio?.proyecto_id || espacio?.proyecto_academico_id || "").trim();
      return this.proyectosCoordinador.includes(proyectoId);
    });
  }

  private obtenerMateriasConCruceHorario(
    cargaActual: any[],
    cargasNuevas: any[],
    espacios: any[] = []
  ): Array<{ nombre: string; bloqueHorario: string }> {
    const snapGridX = 110;
    const hourIni = 6;
    const diasSemana = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

    const mapaEspacios = new Map<string, string>();
    (espacios || []).forEach((e: any) => {
      const id = String(e?.id || e?._id || "").trim();
      const nombreEsp = String(
        e?.espacio_academico || e?.nombre || e?.espacio_academico_nombre || ""
      ).trim();
      if (id) {
        mapaEspacios.set(id, nombreEsp || `Espacio ${id}`);
      }
    });

    const nombreMateria = (carga: any): string => {
      const nombre = String(
        carga?.espacio_academico_nombre ||
        carga?.espacio_academico ||
        carga?.nombre ||
        ""
      ).trim();

      if (nombre) {
        return nombre;
      }

      const id = String(carga?.espacio_academico_id || carga?.espacio_academico || "").trim();
      if (id && id !== "NA") {
        return mapaEspacios.get(id) || `Espacio ${id}`;
      }

      return "Actividad";
    };

    const parseHora = (hora: string): number | null => {
      const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(hora || ""));
      if (!match) {
        return null;
      }

      const horas = Number(match[1]);
      const minutos = Number(match[2]);

      if (Number.isNaN(horas) || Number.isNaN(minutos)) {
        return null;
      }

      return horas + minutos / 60;
    };

    const obtenerBloque = (carga: any): { dia: number; inicio: number; fin: number } | null => {
      const horario = carga?.horario || {};
      const finalPosition =
        horario?.finalPosition || horario?.dragPosition || horario?.prevPosition || {};

      const x = Number(finalPosition?.x);
      if (Number.isNaN(x)) {
        return null;
      }

      const dia = Math.round(x / snapGridX);
      if (dia < 0 || dia > 6) {
        return null;
      }

      const horasDuracion = Number(horario?.horas || carga?.duracion || 0);
      if (!horasDuracion || Number.isNaN(horasDuracion)) {
        return null;
      }

      const horaFormato = String(horario?.horaFormato || "").trim();
      const horaInicioFormato = horaFormato.includes("-")
        ? horaFormato.split("-")[0]
        : "";
      const inicioPorFormato = parseHora(horaInicioFormato);

      let inicioHoras = inicioPorFormato;
      if (inicioHoras === null) {
        const y = Number(finalPosition?.y);
        if (!Number.isNaN(y)) {
          inicioHoras = hourIni + y / 90;
        }
      }

      if (inicioHoras === null || Number.isNaN(inicioHoras)) {
        return null;
      }

      const inicio = Math.round(inicioHoras * 4);
      const fin = inicio + Math.round(horasDuracion * 4);

      if (fin <= inicio) {
        return null;
      }

      return { dia, inicio, fin };
    };

    const formatearHoraCuarto = (valor: number): string => {
      const totalMinutos = Math.round((valor / 4) * 60);
      const horas = Math.floor(totalMinutos / 60);
      const minutos = totalMinutos % 60;
      return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
    };

    const describirBloque = (bloque: { dia: number; inicio: number; fin: number }): string => {
      const dia = diasSemana[bloque.dia] || `Día ${bloque.dia + 1}`;
      return `${dia} ${formatearHoraCuarto(bloque.inicio)} - ${formatearHoraCuarto(bloque.fin)}`;
    };

    const hayCruce = (
      a: { dia: number; inicio: number; fin: number },
      b: { dia: number; inicio: number; fin: number }
    ): boolean => a.dia === b.dia && a.inicio < b.fin && b.inicio < a.fin;

    const conflictos = new Map<string, { nombre: string; bloqueHorario: string }>();
    const registrosNuevos = ((cargasNuevas || [])
      .map((carga: any) => ({
        nombre: nombreMateria(carga),
        bloque: obtenerBloque(carga),
      }))
      .filter((registro: any) => !!registro.bloque)) as Array<{
        nombre: string;
        bloque: { dia: number; inicio: number; fin: number };
      }>;

    const registrosActuales = ((cargaActual || [])
      .map((carga: any) => ({
        nombre: nombreMateria(carga),
        bloque: obtenerBloque(carga),
      }))
      .filter((registro: any) => !!registro.bloque)) as Array<{
        nombre: string;
        bloque: { dia: number; inicio: number; fin: number };
      }>;

    registrosNuevos.forEach((registroNuevo: any, idxNuevo: number) => {
      registrosActuales.forEach((registroActual: any) => {
        if (hayCruce(registroNuevo.bloque, registroActual.bloque)) {
          const llaveNuevo = `${registroNuevo.nombre}__${registroNuevo.bloque.dia}_${registroNuevo.bloque.inicio}_${registroNuevo.bloque.fin}`;
          const llaveActual = `${registroActual.nombre}__${registroActual.bloque.dia}_${registroActual.bloque.inicio}_${registroActual.bloque.fin}`;
          if (!conflictos.has(llaveNuevo)) {
            conflictos.set(llaveNuevo, {
              nombre: registroNuevo.nombre,
              bloqueHorario: describirBloque(registroNuevo.bloque),
            });
          }
          if (!conflictos.has(llaveActual)) {
            conflictos.set(llaveActual, {
              nombre: registroActual.nombre,
              bloqueHorario: describirBloque(registroActual.bloque),
            });
          }
        }
      });

      for (let i = idxNuevo + 1; i < registrosNuevos.length; i++) {
        const comparado = registrosNuevos[i];
        if (hayCruce(registroNuevo.bloque, comparado.bloque)) {
          const llaveNuevo = `${registroNuevo.nombre}__${registroNuevo.bloque.dia}_${registroNuevo.bloque.inicio}_${registroNuevo.bloque.fin}`;
          const llaveComparado = `${comparado.nombre}__${comparado.bloque.dia}_${comparado.bloque.inicio}_${comparado.bloque.fin}`;
          if (!conflictos.has(llaveNuevo)) {
            conflictos.set(llaveNuevo, {
              nombre: registroNuevo.nombre,
              bloqueHorario: describirBloque(registroNuevo.bloque),
            });
          }
          if (!conflictos.has(llaveComparado)) {
            conflictos.set(llaveComparado, {
              nombre: comparado.nombre,
              bloqueHorario: describirBloque(comparado.bloque),
            });
          }
        }
      }
    });

    return Array.from(conflictos.values());
  }

  verPTDFirmado(idDoc: any) {
    this.gestorDocumental.get([{ Id: idDoc }]).subscribe((resp: any[]) => {
      this.previewFile(resp[0].url);
    });
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

  regresar() {
    this.loadAsignaciones();
    this.vista = VIEWS.LIST;
  }

  manageChangesInGeneralPTD(event: any) {
    const xd = this.detallesGeneral.carga[0].filter(
      (c: any) => c.docente != event.docente_id
    );
  }

  /**
   * Retorna información del semáforo según el estado del PTD.
   * Rojo: Enviado a docente / No aprobado.
   * Amarillo: Enviado a coordinación / pendiente de revisión.
   * Verde: Aprobado.
   */
  getSemaforoEstado(estado: string, tieneObservaciones?: boolean): { color: string; tooltip: string; icon: string } {
    if (!estado) {
      return {
        color: "#757575",
        tooltip: this.translate.instant("ptd.semaforo_sin_estado"),
        icon: "help_outline",
      };
    }

    const estadoLower = estado.toLowerCase().trim();

    if (estadoLower.includes("no aprobado")) {
      return {
        color: "#F44336",
        tooltip: this.translate.instant("ptd.semaforo_no_aprobado"),
        icon: "cancel",
      };
    }

    if (estadoLower.includes("enviado a docente")) {
      return {
        color: this.esCoordinadorAsignacion ? "#4CAF50" : "#F44336",
        tooltip: estado,
        icon: this.esCoordinadorAsignacion ? "check_circle" : "cancel",
      };
    }

    if (estadoLower.includes("enviado a coordinación") || estadoLower.includes("enviado a coordinacion")) {
      return {
        color: "#FFC107",
        tooltip: estado,
        icon: "autorenew",
      };
    }

    if (estadoLower.includes("aprobado")) {
      return {
        color: "#4CAF50",
        tooltip: this.translate.instant("ptd.semaforo_aprobado"),
        icon: "check_circle",
      };
    }

    const tooltip = tieneObservaciones
      ? this.translate.instant("ptd.semaforo_pendiente_con_observaciones")
      : this.translate.instant("ptd.semaforo_pendiente_sin_observaciones");

    return {
      color: "#FFC107",
      tooltip: tooltip,
      icon: "autorenew",
    };
  }
}
