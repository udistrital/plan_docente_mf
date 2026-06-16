import { AfterViewInit, Component, OnInit, ViewChild } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { ACTIONS, MODALS, ROLES, VIEWS } from 'src/app/models/diccionario';
import { intersection as _intersection, head as _head, cloneDeep as _cloneDeep } from 'lodash-es';
import { TranslateService } from '@ngx-translate/core';
import { PopUpManager } from 'src/app/managers/popUpManager';
import { UserService } from 'src/app/services/user.service';
import { SgaPlanTrabajoDocenteMidService } from 'src/app/services/sga-plan-trabajo-docente-mid.service';
import { ParametrosService } from 'src/app/services/parametros.service';
import { PlanTrabajoDocenteService } from 'src/app/services/plan-trabajo-docente.service';
import { GestorDocumentalService } from 'src/app/services/gestor-documental.service';
import { Periodo } from 'src/app/models/parametros/periodo';
import { RespFormat } from 'src/app/models/response-format';
import { checkContent, checkResponse } from 'src/app/utils/verify-response';
import { EstadoPlan } from 'src/app/models/plan-trabajo-docente/estado-plan';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TercerosService } from 'src/app/services/terceros.service';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { DialogoFirmaPtdComponent } from 'src/app/dialog-components/dialogo-firma-ptd/dialogo-firma-ptd.component';
import { DialogPreviewFileComponent } from 'src/app/dialog-components/dialog-preview-file/dialog-preview-file.component';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';

@Component({
    selector: 'app-verificar-ptd',
    templateUrl: './verificar-ptd.component.html',
    styleUrls: ['./verificar-ptd.component.scss'],
    standalone: false
})
export class VerificarPtdComponent implements OnInit, AfterViewInit {

  readonly VIEWS = VIEWS;
  readonly MODALS = MODALS;
  readonly ACTIONS = ACTIONS;
  vista: Symbol;

  rolesCoord: string[] = [ROLES.COORDINADOR, ROLES.ADMIN_DOCENCIA];
  isCoordinator: string|undefined = undefined;
  roles: string[] = [];
  selection = new SelectionModel<any>(true, []);
  bulkApprovalInProgress = false;
  hasAttemptedToLoad = false;
  documentoDocenteConsulta: string = '';
  terceroIdConsulta: number | null = null;
  sinDatosParaMostrar = false;
  
  dataSource: MatTableDataSource<any>;
  displayedColumns: string[] = ["seleccion", "nombre", "identificacion", "tipo_vinculacion", "periodo_academico", "soporte_documental", "gestion", "semaforo", "estado"];
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  periodos: {select: any, opciones: Periodo[]};
  proyectos: {select: any, opciones: any[]};
  estadosPlan: {select: any, opciones: EstadoPlan[], opcionesfiltradas: EstadoPlan[]};
  _todosLosPeriodos: Periodo[] = [];

  formDocente: FormGroup;
  dataDocente: any = {};
  
  infoPlan: any;

  formVerificar: FormGroup;
  editVerif: boolean = false;
  modoSoloVista: boolean = false;
  planDocenteEstadoGet: any;
  codigoEventoPTD: string = '';
  calendarEventosPTD: any[] = [];
  calendarEventoSeleccionado: any = null;
  enRangoCalendario: boolean = false;

  constructor(
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private userService: UserService,
    private sgaPlanTrabajoDocenteMidService: SgaPlanTrabajoDocenteMidService,
    private parametrosService: ParametrosService,
    private planTrabajoDocenteService: PlanTrabajoDocenteService,
    private gestorDocumental: GestorDocumentalService,
    private builder: FormBuilder,
    private tercerosService: TercerosService,
    private matDialog: MatDialog,
  ) {
    this.vista = VIEWS.LIST;
    this.periodos = {select: undefined, opciones: []};
    this.proyectos = {select: undefined, opciones: []};
    this.estadosPlan = {select: undefined, opciones: [], opcionesfiltradas: []};
    this.dataSource = new MatTableDataSource();
    this.formDocente = this.builder.group({});
    this.formVerificar = this.builder.group({});
  }

  async ngOnInit() {
    this.popUpManager.showLoading();
    try {
      const roles = await this.userService.getUserRoles();
      this.roles = roles;

      if (!this.roles.includes('ADMIN_SGA')) {
        await this.cargarEventoPTD();
      }

      if (this.roles.includes('ADMIN_SGA')) {
        this.isCoordinator = ROLES.COORDINADOR;
      } else {
        this.isCoordinator = _head(_intersection(roles, this.rolesCoord));
      }

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
      console.log('--- Verificar PTD: Verificar Rango Fechas ---');
      console.log('Fecha actual:', ahora);
      console.log('Fecha Inicio Evento:', fechaInicio);
      console.log('Fecha Fin Evento:', fechaFin);
      console.log('¿Está en rango?:', this.enRangoCalendario);
    }
  }

  getSemaforoEstado(row: any): { color: string; tooltip: string; icon: string } {
    const codigo = String(row?.estado_codigo || row?.estado || '').trim();
    if (codigo === 'APR') {
      return {
        color: '#4CAF50',
        tooltip: this.translate.instant('ptd.semaforo_verificar_aprobado'),
        icon: 'check_circle',
      };
    }
    if (codigo === 'ENV_DOC') {
      return {
        color: '#FFC107',
        tooltip: this.translate.instant('ptd.semaforo_verificar_enviado_coordinacion'),
        icon: 'autorenew',
      };
    }
    // N_APR and default
    return {
      color: '#F44336',
      tooltip: this.translate.instant('ptd.semaforo_verificar_no_aprobado'),
      icon: 'cancel',
    };
  }

  esPlanAprobable(row: any): boolean {
    return String(row?.estado_codigo || row?.estado || '').trim() === 'ENV_DOC';
  }

  hayPlanesSeleccionados(): boolean {
    return this.selection.selected.some((row) => this.esPlanAprobable(row));
  }

  isAllSelected(): boolean {
    const filasSeleccionables = this.dataSource.data.filter((row) => this.esPlanAprobable(row));
    return filasSeleccionables.length > 0 && filasSeleccionables.every((row) => this.selection.isSelected(row));
  }

  toggleAllRows(): void {
    const filasSeleccionables = this.dataSource.data.filter((row) => this.esPlanAprobable(row));
    if (this.isAllSelected()) {
      this.selection.deselect(...filasSeleccionables);
      return;
    }
    this.selection.select(...filasSeleccionables.filter((row) => !this.selection.isSelected(row)));
  }

  toggleFila(row: any): void {
    if (!this.esPlanAprobable(row)) {
      return;
    }
    this.selection.toggle(row);
  }

  limpiarSeleccion(): void {
    this.selection.clear();
  }

  private construirPlanParaActualizacion(putPlan: any, concertado: boolean, observacion: string, responsableId: number, estadoPlan: EstadoPlan) {
    const planActualizado = _cloneDeep(putPlan);
    let respuestaJson: any = {};

    if (planActualizado.respuesta) {
      try {
        respuestaJson = JSON.parse(planActualizado.respuesta);
      } catch {
        respuestaJson = {};
      }
    }

    respuestaJson.concertado = concertado;
    respuestaJson.observacion = observacion;
    respuestaJson.responsable_id = responsableId;

    planActualizado.respuesta = JSON.stringify(respuestaJson);
    planActualizado.estado_plan_id = estadoPlan._id;

    return planActualizado;
  }

  private guardarPlanDocente(putPlan: any, mostrarAlertas: boolean = true): Promise<void> {
    return new Promise((resolve, reject) => {
      this.planTrabajoDocenteService.put('plan_docente/' + putPlan._id, putPlan).subscribe({
        next: () => {
          if (mostrarAlertas) {
            this.popUpManager.showSuccessAlert(this.translate.instant('ptd.respuesta_enviada'));
          }
          resolve();
        },
        error: (err) => {
          if (mostrarAlertas) {
            this.popUpManager.showErrorAlert(this.translate.instant('ptd.error_respuesta_enviada'));
          }
          reject(err);
        }
      });
    });
  }

  async aprobarSeleccionados() {
    const planDocenteIds = Array.from(
      new Set(
        this.selection.selected
          .filter((row) => this.esPlanAprobable(row))
          .map((row) => String(row?.id || row?._id || '').trim())
          .filter((id) => !!id)
      )
    );

    if (!planDocenteIds.length) {
      this.popUpManager.showErrorToast(this.translate.instant('ptd.sin_planes_seleccionados'));
      return;
    }

    const confirmacion = await this.popUpManager.showPopUpGeneric(
      this.translate.instant('ptd.aprobar_seleccionados'),
      this.translate.instant('ptd.confirmar_aprobacion_masiva', { cantidad: planDocenteIds.length }),
      MODALS.QUESTION,
      true
    );

    if (!confirmacion.value) {
      return;
    }

    this.bulkApprovalInProgress = true;
    this.popUpManager.showLoading();
    try {
      const responsableId = await this.userService.getPersonaId();
      const observacionMasiva = this.translate.instant('ptd.aprobacion_masiva_observacion');

      const respAprobacionMasiva: any = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.put('plan/aprobacion-masiva', {
          plan_docente_ids: planDocenteIds,
          responsable_id: responsableId,
          observacion: observacionMasiva,
        })
      );

      const resultados = Array.isArray(respAprobacionMasiva?.Data?.resultados)
        ? respAprobacionMasiva.Data.resultados
        : [];
      const aprobados = Number(respAprobacionMasiva?.Data?.aprobados ?? resultados.filter((resultado: any) => resultado.aprobado).length);
      const fallidos = Number(respAprobacionMasiva?.Data?.fallidos ?? resultados.filter((resultado: any) => !resultado.aprobado).length);

      this.popUpManager.closeLoading();

      if (aprobados > 0) {
        this.popUpManager.showSuccessAlert(
          this.translate.instant('ptd.aprobacion_masiva_exitosa', { cantidad: aprobados })
        );
      }
      if (fallidos > 0) {
        this.popUpManager.showErrorToast(
          this.translate.instant('ptd.aprobacion_masiva_error', { cantidad: fallidos })
        );
      }

      this.limpiarSeleccion();
      await this.filtrarPlanes();
    } catch (error) {
      this.popUpManager.closeLoading();
      console.warn(error);
      this.popUpManager.showPopUpGeneric(
        this.translate.instant('ERROR.titulo_generico'),
        this.translate.instant('ERROR.persiste_error_comunique_OAS'),
        MODALS.ERROR,
        false
      );
    } finally {
      this.bulkApprovalInProgress = false;
      this.popUpManager.closeLoading();
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
    this.formDocente = this.builder.group({
      Nombre: [this.dataDocente.Nombre],
      Documento: [this.dataDocente.Documento],
      Periodo: [this.dataDocente.Periodo],
    });
    this.formVerificar = this.builder.group({
      DeAcuerdo: ['', Validators.required],
      EstadoAprobado: ['', Validators.required],
      Observaciones: ['', Validators.required],
      QuienResponde: ['', Validators.required],
      Rol: ['', Validators.required],
    });
  }

  accionSoporte(event: any) {
    const idDoc = Number(event.value);
    if (idDoc > 0) {
      this.verPTDFirmado(idDoc);
    } else {
      this.generarReporte('CA', event.rowData.tercero_id, event.rowData.vinculacion_id);
    }
  }

  accionGestion(event: any) {
    this.modoSoloVista = event?.rowData?.gestion?.type === 'ver';
    this.popUpManager.showLoading();
    this.cargarPlan(event.rowData).catch(() => {
      this.popUpManager.closeLoading();
    });
  }

  loadPeriodo(): Promise<Periodo[]> {
    return new Promise((resolve, reject) => {
      this.parametrosService.get('periodo?query=CodigoAbreviacion:PA&sortby=Id&order=desc&limit=0').subscribe({
        next: (resp: RespFormat) => {
          if (checkResponse(resp) && checkContent(resp.Data)) {
            resolve(resp.Data as Periodo[]);
          } else {
            reject(new Error('No se encontraron periodos'));
          }
        },
        error: (err) => {
          reject(err);
        }
      });
    });
  }


  private obtenerDocumentoCoordinador(): string | null {
    if (this.roles.includes('ADMIN_SGA')) {
      return this.documentoDocenteConsulta || null;
    }
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


  cargarEstadosPlan(): Promise<EstadoPlan[]> {
    return new Promise((resolve, reject) => {
      this.planTrabajoDocenteService.get('estado_plan?query=activo:true&limit=0').subscribe({
        next: (res) => {
          if (res.Data.length > 0) {
            resolve(res.Data)
          } else {
            reject(new Error('No se encontraron estados de plan'))
          }
        },
        error: (err) => {
          reject(err)
        }
      });
    });
  }

  async loadSelects() {
    try {
      let promesas: Promise<void>[] = [];
      promesas.push(this.loadPeriodo().then(periodos => {
        this.periodos.opciones = periodos;
        this._todosLosPeriodos = [...periodos];
      }));
      promesas.push(this.cargarEstadosPlan().then(estadosPlan => {
        this.estadosPlan.opciones = estadosPlan;
        this.estadosPlan.opcionesfiltradas = this.estadosPlan.opciones.filter(estado => (estado.codigo_abreviacion == "APR") || (estado.codigo_abreviacion == "N_APR"));
      }));
      await Promise.all(promesas);
    } catch (error) {
      console.warn(error);
      this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'),
        this.translate.instant('ERROR.sin_informacion_en') + ': <b>' + error + '</b>.<br><br>' +
        this.translate.instant('ERROR.persiste_error_comunique_OAS'),
        MODALS.ERROR, false);
    }
  }

  onProyectoChange() {
    this.periodos.select = undefined;
    this.periodos.opciones = [];
    this.dataSource = new MatTableDataSource();
    this.limpiarSeleccion();
    if (this.proyectos.select) {
      this.filtrarPeriodosPorCalendario();
    }
  }

  async procesarDocumentoSuperusuario() {
    if (!this.documentoDocenteConsulta) {
      this.proyectos.opciones = [];
      this.periodos.opciones = [];
      this.proyectos.select = null;
      this.periodos.select = null;
      this.dataSource.data = [];
      this.terceroIdConsulta = null;
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
        this.proyectos.opciones = [];
        this.periodos.opciones = [];
        this.proyectos.select = null;
        this.periodos.select = null;
        this.dataSource.data = [];
        this.terceroIdConsulta = null;
        return;
      }
      this.terceroIdConsulta = dataTercero[0].TerceroId.Id;

      // 2. Load calendar events and projects for this teacher's document
      await this.cargarEventoPTD();
      
      this.proyectos.select = null;
      this.periodos.select = null;
      this.periodos.opciones = [];
      this.dataSource.data = [];
      this.hasAttemptedToLoad = false;
    } catch (err) {
      console.error(err);
      this.popUpManager.showErrorToast(this.translate.instant("ERROR.persiste_error_comunique_OAS"));
    } finally {
      this.popUpManager.closeLoading();
    }
  }

  esModoLecturaPorCalendario(): boolean {
    if (this.roles.includes('ADMIN_SGA')) {
      return true;
    }
    return !!this.periodos.select?.Id && !this.enRangoCalendario;
  }

  async onPeriodoChange() {
    this.dataSource = new MatTableDataSource();
    this.limpiarSeleccion();
    if (this.periodos.select) {
      this.verificarRangoFechas();
      if (this.proyectos.select) {
        await this.filtrarPlanes();
      }
    }
  }

  async filtrarPlanes(): Promise<void> {
    this.limpiarSeleccion();
    this.hasAttemptedToLoad = false;
    this.sinDatosParaMostrar = false;
    this.popUpManager.showLoading();
    try {
      if (this.periodos.select && (this.proyectos.select || this.roles.includes(ROLES.DOCENTE))) {
        const estadosVerificacion = this.estadosPlan.opciones
          .filter((estado) => ["ENV_DOC", "APR", "N_APR"].includes(estado.codigo_abreviacion))
          .map((estado) => estado._id)
          .filter((id) => !!id);

        if (!estadosVerificacion.length) {
          this.dataSource = new MatTableDataSource();
          this.sinDatosParaMostrar = true;
        } else {
          const respuestas = await Promise.all(
            estadosVerificacion.map((estadoId) => {
              let queryStr = `plan_docente?query=activo:true,periodo_id:${this.periodos.select.Id},estado_plan_id:${estadoId}`;
              if (this.roles.includes('ADMIN_SGA') && this.terceroIdConsulta) {
                queryStr += `,docente_id:${this.terceroIdConsulta}`;
              }
              queryStr += `&limit=0`;
              return firstValueFrom(
                this.planTrabajoDocenteService.get(queryStr)
              );
            })
          );

          const planes = respuestas.flatMap((respuesta: any) =>
            Array.isArray(respuesta?.Data) ? respuesta.Data : []
          );
          const proyectoSeleccionado = String(this.proyectos.select?.Id || "").trim();
          const periodoSeleccionado = this.periodos.opciones.find(
            (periodo) => periodo.Id === this.periodos.select.Id
          )?.Nombre;

          const resultados: any[] = [];
          const modoLectura = this.esModoLecturaPorCalendario();

          for (const plan of planes) {
            const detallePlan: any = await firstValueFrom(
              this.sgaPlanTrabajoDocenteMidService.get(
                `plan?docente=${plan.docente_id}&vigencia=${plan.periodo_id}&vinculacion=${plan.tipo_vinculacion_id}`
              )
            );

            const seleccion = Number(detallePlan?.Data?.seleccion || 0);
            const espacios = Array.isArray(detallePlan?.Data?.espacios_academicos?.[seleccion])
              ? detallePlan.Data.espacios_academicos[seleccion]
              : [];

            const perteneceProyecto = !proyectoSeleccionado || espacios.some((espacio: any) =>
              String(espacio?.proyecto_id || espacio?.proyecto_academico_id || "").trim() === proyectoSeleccionado
            );

            if (!perteneceProyecto) {
              continue;
            }

            const docente = detallePlan?.Data?.docente || {};
            const tipoVinculacion = Array.isArray(detallePlan?.Data?.tipo_vinculacion)
              ? detallePlan.Data.tipo_vinculacion.find((vinc: any) => vinc.id === plan.tipo_vinculacion_id)
              : undefined;
            const estadoPlan = this.estadosPlan.opciones.find(
              (estado) => estado._id === plan.estado_plan_id
            );

            resultados.push({
              id: plan._id || plan.id,
              nombre: docente.nombre1 && docente.apellido1
                ? `${docente.nombre1} ${docente.apellido1}`
                : docente.nombre || "",
              identificacion: docente.identificacion || "",
              tipo_vinculacion: tipoVinculacion?.nombre || "",
              periodo_academico: periodoSeleccionado || detallePlan?.Data?.periodo_academico || "",
              soporte_documental: {
                value: plan.soporte_documental,
                type: "ver",
                disabled: !plan.soporte_documental || estadoPlan?.codigo_abreviacion !== "APR",
              },
              gestion: {
                value: undefined,
                type: modoLectura ? "ver" : "editar",
                disabled: false,
              },
              estado: estadoPlan ? estadoPlan.nombre : plan.estado_plan_id,
              estado_codigo: estadoPlan ? estadoPlan.codigo_abreviacion : plan.estado_plan_id,
              tercero_id: plan.docente_id,
              vinculacion_id: plan.tipo_vinculacion_id,
            });
          }

          if (!resultados.length) {
            this.dataSource = new MatTableDataSource();
            this.sinDatosParaMostrar = true;
          } else {
            this.dataSource = new MatTableDataSource(resultados);
            this.dataSource.paginator = this.paginator;
            this.dataSource.sort = this.sort;
            this.limpiarSeleccion();
          }
        }
      }
    } finally {
      this.hasAttemptedToLoad = true;
      this.popUpManager.closeLoading();
    }
  }

  async cargarPlan(plan: any) {
    try {
      const resp: any = await firstValueFrom(
        this.sgaPlanTrabajoDocenteMidService.get(`plan?docente=${plan.tercero_id}&vigencia=${this.periodos.select.Id}&vinculacion=${plan.vinculacion_id}`)
      );
      this.dataDocente = {
        Nombre: plan.nombre,
        Documento: plan.identificacion,
        Periodo: plan.periodo_academico,
        docente_id: plan.tercero_id,
        tipo_vinculacion_id: plan.vinculacion_id
      };
      this.formDocente.patchValue({
        Nombre: this.dataDocente.Nombre,
        Documento: this.dataDocente.Documento,
        Periodo: this.dataDocente.Periodo,
      })
      this.infoPlan = resp.Data;
      
      this.formVerificar.patchValue({
        Rol: this.isCoordinator,
      })

      const resPlan: any = await firstValueFrom(
        this.planTrabajoDocenteService.get('plan_docente/'+plan.id)
      );
      this.planDocenteEstadoGet = resPlan.Data;
      if (resPlan.Data.respuesta && resPlan.Data.respuesta != "") {
        const jsonResp = JSON.parse(resPlan.Data.respuesta);
        const terceroId = jsonResp.responsable_id;
        if (terceroId) {
          const estadoPlan = this.estadosPlan.opciones.find(estado => estado._id === resPlan.Data.estado_plan_id);
          this.editVerif = (estadoPlan?.codigo_abreviacion == "APR") || false;
          this.formVerificar.patchValue({
            DeAcuerdo: jsonResp.concertado,
            Observaciones: jsonResp.observacion,
            EstadoAprobado: estadoPlan,
          })
          await this.getInfoResponsable(terceroId);
        } else {
          try {
            const terceroId = await this.userService.getPersonaId();
            await this.getInfoResponsable(terceroId);
          } catch {
            this.formVerificar.patchValue({
              QuienResponde: 'ADMIN_SGA',
            });
          }
        }
      } else {
        try {
          const terceroId = await this.userService.getPersonaId();
          await this.getInfoResponsable(terceroId);
        } catch {
          this.formVerificar.patchValue({
            QuienResponde: 'ADMIN_SGA',
          });
        }
      }
      this.actualizarModoFormularioVerificacion();
      this.vista = VIEWS.FORM;
      this.popUpManager.closeLoading();
    } catch (err) {
      this.popUpManager.closeLoading();
      console.warn(err);
      this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
    }
  }

  async getInfoResponsable(terceroId: number) {
    try {
      const resTerc: any = await firstValueFrom(
        this.tercerosService.get('tercero/' + terceroId)
      );
      this.formVerificar.patchValue({
        QuienResponde: resTerc.NombreCompleto,
      })
    } catch (err) {
      console.warn(err);
      throw new Error(this.translate.instant('GLOBAL.error'));
    }
  }

  validarFormVerificar() {
    if (this.modoSoloVista) {
      return;
    }

    this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.dar_respuesta'), "", MODALS.QUESTION, true).then(
      async action => {
        if (action.value) {
          this.userService.getPersonaId().then(async terceroId => {
            const estAprov = this.formVerificar.get('EstadoAprobado')?.value;
            const putPlan = this.construirPlanParaActualizacion(
              this.planDocenteEstadoGet,
              this.formVerificar.get('DeAcuerdo')?.value,
              this.formVerificar.get('Observaciones')?.value,
              terceroId,
              estAprov
            );
            
            if (estAprov.codigo_abreviacion === "APR") {
              const dialogParams = new MatDialogConfig();
              dialogParams.width = '40vw';
              dialogParams.minWidth = '540px';
              dialogParams.height = '40vh';
              dialogParams.maxHeight = '390px';
              dialogParams.data = {
                docenteId: putPlan.docente_id,
                responsableId: terceroId,
                vinculacionId: this.dataDocente.tipo_vinculacion_id,
                periodoId: this.periodos.select.Id,
              };
              const dialogFirma = this.matDialog.open(DialogoFirmaPtdComponent, dialogParams);
              const outDialog = await dialogFirma.afterClosed().toPromise();
              if (outDialog.document) {
                putPlan.soporte_documental = outDialog.document;
                this.guardarPlanDocente(putPlan);
              } else if (outDialog.error) {
                this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'),
                                          this.translate.instant('ERROR.fallo_informacion_en') + ': <b>' + outDialog.from + '</b>.<br><br>' +
                                          this.translate.instant('ERROR.persiste_error_comunique_OAS'),
                                          MODALS.ERROR, false);
              }
            } else {
              this.guardarPlanDocente(putPlan);
            }
          }).catch(err => {
            console.warn(err);
            this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
          })
        }
      }
    );
  }

  generarReporte(tipoCarga: string, docente?: any, vinculacion?: any) {
    this.sgaPlanTrabajoDocenteMidService.get(`reporte/plan-trabajo-docente?docente=${docente ? docente : this.dataDocente.docente_id}`+
      `&vinculacion=${vinculacion ? vinculacion : this.dataDocente.tipo_vinculacion_id}&periodo=${this.periodos.select.Id}&carga=${tipoCarga}`).subscribe(
      resp => {
        const rawFilePDF = new Uint8Array(atob(resp.Data.pdf).split('').map(char => char.charCodeAt(0)));
        const urlFilePDF = window.URL.createObjectURL(new Blob([rawFilePDF], { type: 'application/pdf' }));
        this.previewFile(urlFilePDF)
        const rawFileExcel = new Uint8Array(atob(resp.Data.excel).split('').map(char => char.charCodeAt(0)));
        const urlFileExcel = window.URL.createObjectURL(new Blob([rawFileExcel], { type: 'application/vnd.ms-excel' }));

        const html = {
          html: [
            `<label class="swal2">${this.translate.instant('ptd.formato_doc')}</label>
            <select id="formato" class="swal2-input">
            <option value="excel" >Excel</option>
            <option value="pdf" >PDF</option>
            </select>`
          ],
          ids: ["formato"],
        }
        this.popUpManager.showPopUpForm(this.translate.instant('ptd.descargar'), html, false).then((action) => {
          if (action.value) {
            if (action.value.formato === "excel") {
              const download = document.createElement("a");
              download.href = urlFileExcel;
              download.download = "Reporte_PTD.xlsx";
              document.body.appendChild(download);
              download.click();
              document.body.removeChild(download);
            }
            if (action.value.formato === "pdf") {
              const download = document.createElement("a");
              download.href = urlFilePDF;
              download.download = "Reporte_PTD.pdf";
              document.body.appendChild(download);
              download.click();
              document.body.removeChild(download);
            }
          }
        })
        
      }, err => {
        this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
        console.warn(err)
      }
    )
  }

  verPTDFirmado(idDoc: number) {
    this.gestorDocumental.get([{Id: idDoc}]).subscribe((resp: any[]) => {
      this.previewFile(resp[0].url);
    })
  }

  previewFile(url: string) {
    const dialogDoc = new MatDialogConfig();
    dialogDoc.width = '65vw';
    dialogDoc.height = '80vh';
    dialogDoc.data = { url: url, title: this.translate.instant('GLOBAL.soporte_documental') };
    this.matDialog.open(DialogPreviewFileComponent, dialogDoc);
  }

  regresar() {
    this.modoSoloVista = false;
    this.filtrarPlanes();
    this.limpiarSeleccion();
    this.vista = VIEWS.LIST;
  }

  private actualizarModoFormularioVerificacion(): void {
    if (this.modoSoloVista) {
      this.formVerificar.disable({ emitEvent: false });
      return;
    }

    this.formVerificar.enable({ emitEvent: false });
  }

}
