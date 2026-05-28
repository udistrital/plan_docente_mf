import { AfterViewInit, Component, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { TranslateService } from '@ngx-translate/core';
import { PopUpManager } from 'src/app/managers/popUpManager';
import { MODALS, ROLES, VIEWS } from 'src/app/models/diccionario';
import { Periodo } from 'src/app/models/parametros/periodo';
import { EstadoConsolidado } from 'src/app/models/plan-trabajo-docente/estado-consolidado';
import { RespFormat } from 'src/app/models/response-format';
import { ParametrosService } from 'src/app/services/parametros.service';
import { PlanTrabajoDocenteService } from 'src/app/services/plan-trabajo-docente.service';
import { TercerosService } from 'src/app/services/terceros.service';
import { UserService } from 'src/app/services/user.service';
import { GestorDocumentalService } from 'src/app/services/gestor-documental.service';
import { SgaPlanTrabajoDocenteMidService } from 'src/app/services/sga-plan-trabajo-docente-mid.service';
import { checkContent, checkResponse } from 'src/app/utils/verify-response';
import { cloneDeep as _cloneDeep } from 'lodash-es';
import { PermisosUtils } from 'src/app/utils/role-permissions';
import { forkJoin } from 'rxjs/internal/observable/forkJoin';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { Observable } from 'rxjs/internal/Observable';

@Component({
    selector: 'app-revision-consolidado',
    templateUrl: './revision-consolidado.component.html',
    styleUrls: ['./revision-consolidado.component.scss'],
    standalone: false
})
export class RevisionConsolidadoComponent implements OnInit, AfterViewInit {

  readonly VIEWS = VIEWS;
  readonly ESTADOS = {
    ENV: '64e4c32cd9308025c135db2d',
    APR: '64e4c382d93080d1e835db31',
    N_APR: '64e4c3a5d93080299535db34',
  };
  vista: Symbol;

  roles: string[] = [];

  opcionesPermisos: string[] = [
    'ver_gestion_consolidado',
    'editar_gestion_consolidado',
    'ver_consolidados_decanatura',
  ];
  permisos: { [key: string]: boolean } = {};

  dataSource: MatTableDataSource<any>;
  displayedColumns: string[] = ["proyecto_curricular", "codigo", "fecha_radicado", "periodo_academico", "gestion", "estado"];
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  periodos: {select: any, opciones: Periodo[]};
  proyectos: {select: any, opciones: any[]};
  estadosConsolidado: {select: any, opciones: any[]};

  formRevConsolidado: FormGroup;
  revConsolidadoInfo: any = undefined;
  consolidadoSololectura = false;
  archivoSoporteUrl: string | null = null;
  archivoSoporteNombre: string | null = null;
  opcionesDecision: { id: string; nombre: string }[] = [];
  codigoEventoPTD: string = '';
  calendarEventosPTD: any[] = [];
  calendarEventoSeleccionado: any = null;
  enRangoCalendario: boolean = false;
  _todosLosPeriodos: Periodo[] = [];

  constructor(
    private userService: UserService,
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private parametrosService: ParametrosService,
    private planTrabajoDocenteService: PlanTrabajoDocenteService,
    private tercerosService: TercerosService,
    private gestorDocumentalService: GestorDocumentalService,
    private sgaPlanTrabajoDocenteMidService: SgaPlanTrabajoDocenteMidService,
    private builder: FormBuilder,
    private permisosUtils:PermisosUtils,
  ) {
    this.vista = VIEWS.LIST;
    this.dataSource = new MatTableDataSource();
    this.periodos = {select: undefined, opciones: []};
    this.proyectos = {select: undefined, opciones: []};
    this.estadosConsolidado = {select: undefined, opciones: []};
    this.formRevConsolidado = this.builder.group({});
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
      this.buildForm();
    } catch (err) {
      this.popUpManager.showErrorAlert(this.translate.instant("ERROR.persiste_error_comunique_OAS"));
    } finally {
      this.popUpManager.closeLoading();
    }
  }

  ngAfterViewInit() {
    this.conectarPaginadorYOrdenador();
  }

  private conectarPaginadorYOrdenador() {
    if (this.paginator) {
      this.dataSource.paginator = this.paginator;
    }
    if (this.sort) {
      this.dataSource.sort = this.sort;
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
              this.cargarCalendarioEventos().then(eventosCalendario => {
              this.calendarEventosPTD = eventosCalendario;
              this.resolverProyectosDesdeCalendario();
              this.verificarRangoFechas();
              this.intentarListarConsolidados();
            }).catch(err => console.warn(err));
          }
      }
    }

  cargarCalendarioEventos(proyectoId?: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.userService.getUserDocument().then((documento) => {
        if (!documento || !this.codigoEventoPTD) {
          reject(new Error('No se pudo obtener documento o código de evento'));
          return;
        }
        const proyectoQuery = proyectoId ? `&proyecto=${proyectoId}` : '';
        this.sgaPlanTrabajoDocenteMidService.get(
          `calendario/calendario_eventos?documento=${documento}&codigo_evento=${this.codigoEventoPTD}${proyectoQuery}`
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
      }).catch(reject);
    });
  }

  cargarProyectosFacultadDecano(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.userService.getUserDocument().then((documento) => {
        if (!documento) {
          reject(new Error('No se pudo obtener documento del usuario'));
          return;
        }

        this.sgaPlanTrabajoDocenteMidService.get(`calendario/proyectos_facultad_decano?documento=${documento}`).subscribe({
          next: (resp: any) => {
            if (checkContent(resp)) {
              const proyectos = Array.isArray(resp.Data) ? resp.Data : [];
              this.proyectos.opciones = proyectos
                .map((proyecto: any) => ({
                  Id: String(proyecto.Id ?? proyecto.Codigo ?? '').trim(),
                  Codigo: String(proyecto.Codigo ?? proyecto.Id ?? '').trim(),
                  Nombre: String(proyecto.Nombre ?? '').trim(),
                  CodigoFacultad: String(proyecto.CodigoFacultad ?? '').trim(),
                  Facultad: String(proyecto.Facultad ?? '').trim(),
                  Nivel: String(proyecto.Nivel ?? '').trim(),
                }))
                .filter((proyecto: any) => proyecto.Id && proyecto.Nombre);
              resolve();
            } else {
              reject(new Error('No se encontraron proyectos para la facultad del decano'));
            }
          },
          error: (err: any) => {
            console.warn('Error obteniendo calendario/proyectos_facultad_decano:', err);
            reject(err);
          }
        });
      }).catch(reject);
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
      console.log('--- Revision Consolidado: Verificar Rango Fechas ---');
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

  buildForm() {
    this.formRevConsolidado = this.builder.group({
      ArchivoSoporte: [{ value: '', disabled: true }],
      QuienResponde: [{ value: '', disabled: true }, Validators.required],
      Rol: [{ value: '', disabled: true }, Validators.required],
      CumpleNorma: [false],
      Observaciones: ['', Validators.required],
      Decision: ['', Validators.required],
    });
  }

  accionGestion(event: any) {
    if (!this.permisos['ver_gestion_consolidado']) {
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }
    if (event.rowData.gestion.type === 'editar' && !this.permisos['editar_gestion_consolidado']) {
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }
    const readonly = event.rowData.gestion.type !== 'editar';
    this.revisarConsolidado(event.rowData.ConsolidadoJson, readonly);
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


  cargarEstadosConsolidado(): Promise<EstadoConsolidado[]> {
    return new Promise((resolve, reject) => {
      this.planTrabajoDocenteService.get('estado_consolidado?query=activo:true&limit=0').subscribe({
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
      promesas.push(this.cargarProyectosFacultadDecano());
      promesas.push(this.loadPeriodo().then(periodos => {
        this.periodos.opciones = periodos;
        this._todosLosPeriodos = [...periodos];
      }));
      promesas.push(this.cargarEstadosConsolidado().then(estadosConsolidado => {
        this.estadosConsolidado.opciones = estadosConsolidado;
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
    this.conectarPaginadorYOrdenador();
    if (this.proyectos.select) {
      this.cargarCalendarioEventos(this.proyectos.select.Id).then(eventosCalendario => {
        this.calendarEventosPTD = eventosCalendario;
        this.filtrarPeriodosPorCalendario();
      }).catch((err) => {
        this.calendarEventosPTD = [];
        this.periodos.opciones = [];
        console.warn(err);
      });
    }
  }

  onPeriodoChange() {
    this.dataSource = new MatTableDataSource();
    this.conectarPaginadorYOrdenador();
    if (this.periodos.select) {
      this.verificarRangoFechas();
      if (!this.enRangoCalendario) {
        this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
        return;
      }

      this.listarConsolidados();
    }
  }

  listarConsolidados() {
    if (!this.permisos['ver_consolidados_decanatura']) {
      this.popUpManager.showErrorAlert(
        this.translate.instant('GLOBAL.acceso_denegado')
      );
      return;
    }
    if (!this.enRangoCalendario) {
      this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
      return;
    }
    if (this.periodos.select) {
      let proyecto = ""
      if (this.proyectos.select && !this.roles.includes(ROLES.DOCENTE)) {
        proyecto = ",proyecto_academico_id:"+this.proyectos.select.Id;
      }
      this.planTrabajoDocenteService.get(`consolidado_docente?query=activo:true,periodo_id:${this.periodos.select.Id}${proyecto}&limit=0`).subscribe((resp) => {
        const idEstadosFiltro = this.idEstadosSegunPermisos();
        let rawlistarConsolidados = <any[]>resp.Data;
        if (!rawlistarConsolidados || rawlistarConsolidados.length === 0) {
          this.dataSource = new MatTableDataSource();
          this.conectarPaginadorYOrdenador();
          this.popUpManager.showPopUpGeneric(
            this.translate.instant('ptd.gest_consolidados'),
            'No se encontraron consolidados para el proyecto y periodo seleccionado.',
            MODALS.INFO,
            false
          );
          return;
        }

        rawlistarConsolidados = rawlistarConsolidados.filter(consolidado => idEstadosFiltro.includes(consolidado.estado_consolidado_id));
        const formatedData = this.estilizarDatosSegunPermisos(rawlistarConsolidados);
        this.dataSource = new MatTableDataSource(formatedData);
        this.conectarPaginadorYOrdenador();
      }, (err) => {
        this.dataSource = new MatTableDataSource();
        this.conectarPaginadorYOrdenador();
        console.warn(err);
      });
    }
  }

  idEstadosSegunPermisos(): string[] {
    if (this.roles.includes(ROLES.DECANO)) {
      return [this.ESTADOS.ENV, this.ESTADOS.APR, this.ESTADOS.N_APR];
    }
    return [];
  }

  estilizarDatosSegunPermisos(consolidados: any[]): any[] {
    let formatedData: any[] = [];
    consolidados.forEach(consolidado => {
      const proyecto = this.proyectos.opciones.find(proyecto => proyecto.Id == consolidado.proyecto_academico_id);
      const periodo = this.periodos.opciones.find(periodo => periodo.Id == consolidado.periodo_id);
      const estadoConsolidado = this.estadosConsolidado.opciones.find(estado => estado._id == consolidado.estado_consolidado_id);
      let opcionGestion = "ver";
      if (consolidado.estado_consolidado_id === this.ESTADOS.ENV && this.roles.includes(ROLES.DECANO)) {
        opcionGestion = "editar";
      }
      formatedData.push({
        "proyecto_curricular": proyecto ? proyecto.Nombre : "",
        "codigo": proyecto ? proyecto.Codigo : "",
        "fecha_radicado": this.formatoFecha(consolidado.fecha_creacion),
        "periodo_academico": periodo ? periodo.Nombre : "",
        "gestion": { value: undefined, type: opcionGestion, disabled: !this.permisos['ver_gestion_consolidado'] },
        "estado": estadoConsolidado ? estadoConsolidado.nombre : consolidado.estado_consolidado_id,
        "ConsolidadoJson": consolidado
      })
    })
    return formatedData;
  }

  formatoFecha(fechaHora: string): string {
    return new Date(fechaHora).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  }

  revisarConsolidado(consolidado: any, readonly?: boolean) {
    this.revConsolidadoInfo = _cloneDeep(consolidado);
    this.consolidadoSololectura = !!readonly;
    this.archivoSoporteUrl = null;
    this.archivoSoporteNombre = null;

    this.formRevConsolidado.patchValue({
      ArchivoSoporte: '',
      QuienResponde: '',
      Rol: 'Decanatura',
      CumpleNorma: !!consolidado.cumple_normativa,
      Observaciones: '',
      Decision: '',
    });

    this.configurarOpcionesPorPermisos();

    const estadoActualId = consolidado.estado_consolidado_id;
    if (this.roles.includes(ROLES.DECANO) && [this.ESTADOS.APR, this.ESTADOS.N_APR].includes(estadoActualId)) {
      this.formRevConsolidado.patchValue({ Decision: estadoActualId });
    }

    const consolidadoCoordinacion = this.parseJson(this.revConsolidadoInfo.consolidado_coordinacion, {});
    if (consolidadoCoordinacion.documento_id) {
      this.cargarArchivoSoporte(consolidadoCoordinacion.documento_id);
    }

    const respuestaDecanatura = this.parseJson(this.revConsolidadoInfo.respuesta_decanatura, { sec: {}, dec: {} });
    let terceroId = 0;
    if (respuestaDecanatura?.dec) {
      this.formRevConsolidado.patchValue({ Observaciones: respuestaDecanatura.dec.observacion || '' });
      terceroId = respuestaDecanatura.dec.responsable_id || 0;
    }

    if (!terceroId) {
      this.userService.getPersonaId().then((personaId) => {
        this.cargarResponsable(personaId);
      });
    } else {
      this.cargarResponsable(terceroId);
    }

    this.vista = VIEWS.FORM;
    if (this.consolidadoSololectura) {
      this.formRevConsolidado.disable();
    } else {
      this.formRevConsolidado.enable();
      this.formRevConsolidado.get('ArchivoSoporte')?.disable();
      this.formRevConsolidado.get('QuienResponde')?.disable();
      this.formRevConsolidado.get('Rol')?.disable();
    }
  }

  async validarFormRevConsolidado() {
    if (!this.revConsolidadoInfo || this.formRevConsolidado.invalid) {
      this.formRevConsolidado.markAllAsTouched();
      return;
    }

    const putPlan = _cloneDeep(this.revConsolidadoInfo);
    const personaId = await this.userService.getPersonaId();
    const respuestaDecanatura = this.parseJson(putPlan.respuesta_decanatura, { sec: {}, dec: {} });

    respuestaDecanatura.dec = {
      ...respuestaDecanatura.dec,
      responsable_id: personaId,
      observacion: this.formRevConsolidado.get('Observaciones')?.value,
    };
    putPlan.cumple_normativa = !!this.formRevConsolidado.get('CumpleNorma')?.value;

    putPlan.estado_consolidado_id = this.formRevConsolidado.get('Decision')?.value;
    putPlan.aprobado = putPlan.estado_consolidado_id === this.ESTADOS.APR;
    putPlan.respuesta_decanatura = JSON.stringify(respuestaDecanatura);

    this.planTrabajoDocenteService.put('consolidado_docente/' + putPlan._id, putPlan).subscribe(
      () => {
        this.popUpManager.showSuccessAlert(this.translate.instant('ptd.actualizar_consolidado_ok'));
        this.regresar();
      },
      (err) => {
        console.warn(err);
        this.popUpManager.showErrorAlert(this.translate.instant('ptd.fallo_actualizar_consolidado'));
      }
    );
  }

  private configurarOpcionesPorPermisos() {
    this.opcionesDecision = [
      { id: this.ESTADOS.APR, nombre: 'Aprobar consolidado' },
      { id: this.ESTADOS.N_APR, nombre: 'No aprobar consolidado' },
    ];
    this.formRevConsolidado.get('CumpleNorma')?.enable();
  }

  private cargarArchivoSoporte(documentoId: number) {
    this.gestorDocumentalService.get([
      {
        Id: documentoId,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ]).subscribe({
      next: (resp: any[]) => {
        if (resp && resp.length > 0) {
          this.archivoSoporteUrl = resp[0].url;
          this.archivoSoporteNombre = resp[0].Nombre || 'Consolidado.xlsx';
          this.formRevConsolidado.patchValue({ ArchivoSoporte: this.archivoSoporteNombre });
        }
      },
      error: (err) => {
        console.warn(err);
        this.popUpManager.showErrorAlert(this.translate.instant('ERROR.error_cargar_documento'));
      }
    });
  }

  descargarArchivoSoporte() {
    if (this.archivoSoporteUrl && this.archivoSoporteNombre) {
      const link = document.createElement('a');
      link.href = this.archivoSoporteUrl;
      link.download = this.archivoSoporteNombre;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  private cargarResponsable(terceroId: number) {
    this.tercerosService.get('tercero/' + terceroId).subscribe({
      next: (resTerc: any) => {
        this.formRevConsolidado.patchValue({ QuienResponde: resTerc.NombreCompleto || '' });
      },
      error: (err) => {
        console.warn(err);
      }
    });
  }

  private parseJson(value: any, defaultValue: any) {
    if (!value) {
      return defaultValue;
    }
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return defaultValue;
    }
  }

  regresar() {
    this.vista = VIEWS.LIST;
    this.revConsolidadoInfo = undefined;
    this.consolidadoSololectura = false;
    this.listarConsolidados();
  }

}
