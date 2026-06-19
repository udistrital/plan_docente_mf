import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  ViewChild,
  ChangeDetectorRef,
} from "@angular/core";
import {
  CdkDragMove,
  CdkDragRelease,
  CdkDragStart,
} from "@angular/cdk/drag-drop";
import { TranslateService } from "@ngx-translate/core";
import { Subject, firstValueFrom } from "rxjs";
import { distinctUntilChanged } from "rxjs/operators";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { PopUpManager } from "src/app/managers/popUpManager";
import { PlanTrabajoDocenteService } from "src/app/services/plan-trabajo-docente.service";
import { AcademicaJbpmService } from "src/app/services/academica-jbpm.service";
import { ACTIONS, MODALS, ROLES, VIEWS } from "src/app/models/diccionario";
import { CardDetalleCarga, CoordXY } from "src/app/models/card-detalle-carga";
import { SgaPlanTrabajoDocenteMidService } from "src/app/services/sga-plan-trabajo-docente-mid.service";
import { HorarioMidService } from "src/app/services/horario-mid.service";
import { MatDialog } from "@angular/material/dialog";
import { DialogoVerDetalleColocacionComponent } from "src/app/dialog-components/dialogo-ver-detalles-colocacion/dialogo-ver-detalle-colocacion.component";
import { EspaciosAcademicosService } from "src/app/services/espacios-academicos.service";
import { NewNuxeoService } from "src/app/services/new_nuxeo.service";
import { DocumentoService } from "src/app/services/documento.service";
import { ParametrosService } from "src/app/services/parametros.service";

@Component({
  selector: "horario-carga-lectiva",
  templateUrl: "./horario-carga-lectiva.component.html",
  styleUrls: ["./horario-carga-lectiva.component.scss"],
  standalone: false
})
export class HorarioCargaLectivaComponent implements OnInit, OnChanges {
  /** Definitions for horario */
  readonly horarioSize = {
    days: 7,
    hourIni: 6,
    hourEnd: 23,
    difHoras: 23 - 6,
    stepHour: 0.25,
  };
  readonly containerGridLengths = {
    x: this.horarioSize.days,
    y: this.horarioSize.hourEnd - this.horarioSize.hourIni,
  };
  readonly snapGridSize = { x: 110, y: 90, ymin: 90 * 0.25 }; //px no olvide editarlas en scss si las cambia
  readonly containerGridsize = {
    x: this.containerGridLengths.x * this.snapGridSize.x,
    y: this.containerGridLengths.y * this.snapGridSize.y,
  };
  readonly tipo = { carga_lectiva: 1, actividades: 2, carga_horario: 3 };
  readonly estado = { flotando: 1, ubicado: 2, ocupado: 3 };

  matrixBusy = Array(this.containerGridLengths.x)
    .fill(0)
    .map(() =>
      Array(this.containerGridLengths.y / this.horarioSize.stepHour)
        .fill(0)
        .map(() => false)
    );

  genHoursforTable() {
    return Array(this.horarioSize.hourEnd - this.horarioSize.hourIni)
      .fill(0)
      .map((_, index) => index + this.horarioSize.hourIni);
  }

  @ViewChild("contenedorCargaLectiva", { static: false })
  contenedorCargaLectiva: ElementRef;
  listaCargaLectiva: any[] = [];
  listaRestriccionesHorario: any[] = [];
  listaColocacionesModuloHorario: any[] = [];
  /*************************** */

  /** Entradas y Salidas */
  @Input() WorkingMode: Symbol = Symbol();
  @Input() Rol: string = "";
  @Input() Data: any = undefined;
  @Input() VigenciaActiva: boolean = true;
  @Output() OutLoading: EventEmitter<boolean> = new EventEmitter();
  @Output() DataChanged: EventEmitter<any> = new EventEmitter();

  edit: boolean = false;
  isDocente: boolean = false;
  isCoordinador: boolean = false;
  vinculaciones: any[] = [];
  asignaturas: any[] = [];
  actividades: any[] = [];
  vinculacionSelected: any = undefined;
  asignaturaSelected: any = undefined;
  actividadSelected: any = undefined;
  seleccion: number = 0;
  identificador: number = 0;
  observacion: string = "";
  observacionArchivo: string = "";
  archivo: any = null;
  archivosSoporte: any[] = [];
  archivosIdsExistentes: number[] = [];
  searchTerm$ = new Subject<any>();
  opcionesEdificios: any[] = [];
  opcionesSedes: any[] = [];
  opcionesSalones: any[] = [];
  opcionesSalonesFiltrados: any[] = [];
  opcionesUsos: any[] = [];
  sede: any;
  edificio: any;
  salon: any;
  grupo: any;
  ubicacionForm: FormGroup;
  ubicacionActive: boolean = false;
  editandoAsignacion: CardDetalleCarga;
  EspaciosProyecto: any = undefined;
  manageByTime: boolean = false;
  puedeEditarPTD: boolean = false;
  private dragEnabled = false;
  private readonly TIEMPO_COMPLETO = ["DCTC", "TCO"];
  private readonly MEDIO_TIEMPO = ["DCMT", "MTO"];

  // Tipo de documento en documento_crud para soportes de PTD
  private readonly codigoAbreviacionTipoDocPtd = "SOPPLTRDOC";
  private tipoDocumentoPtdId: number | null = null;

  banderaInfoNoSoltarTarjeta = false;
  mostrarDetalleActividades = false;
  mostrarSelectorActividadesNoLectivas = false;
  get deshabilitarVinculacion(): boolean {
    if (!this.Data || !this.Data.plan_docente) {
      return false;
    }
    const planDocente = this.Data.plan_docente[this.seleccion];
    if (!planDocente) {
      return false;
    }
    const planId = typeof planDocente === "object"
      ? (planDocente?._id || planDocente?.id)
      : planDocente;
    const isDisabled = !!(planId && String(planId).trim() !== "" && String(planId).trim() !== "0");
    return isDisabled;
  }

  get esModoVistaLecturaEstricta(): boolean {
    return this.WorkingMode === ACTIONS.VIEW && !this.VigenciaActiva;
  }

  constructor(
    public dialog: MatDialog,
    private espacioAcademicoService: EspaciosAcademicosService,
    private popUpManager: PopUpManager,
    private translate: TranslateService,
    private horarioMid: HorarioMidService,
    private planDocenteMid: SgaPlanTrabajoDocenteMidService,
    private planDocenteService: PlanTrabajoDocenteService,
    private builder: FormBuilder,
    private academicaJbpmService: AcademicaJbpmService,
    private readonly elementRef: ElementRef,
    private gestorDocumentalService: NewNuxeoService,
    private documentoService: DocumentoService,
    private parametrosService: ParametrosService,
    private cdr: ChangeDetectorRef
  ) {
    this.contenedorCargaLectiva = this.elementRef.nativeElement;
    this.ubicacionForm = this.builder.group({});
    const x = this.snapGridSize.x * -2.25;
    const y = 0;
    this.editandoAsignacion = {
      id: null,
      nombre: "",
      idCarga: null,
      idEspacioAcademico: null,
      idActividad: null,
      horas: 0,
      horaFormato: null,
      tipo: null,
      sede: null,
      edificio: null,
      salon: null,
      estado: null,
      bloqueado: true,
      dragPosition: { x, y },
      prevPosition: { x, y },
      finalPosition: { x, y },
    };
  }

  async ngOnInit() {
    await this.cargarTipoDocumentoSoporte();
    const roles = typeof this.Rol === 'string' && this.Rol.trim().length > 0 ? [this.Rol] : [];
    this.isDocente = roles.includes(ROLES.DOCENTE) && this.Rol == ROLES.DOCENTE;
    this.isCoordinador = roles.includes(ROLES.ADMIN_DOCENCIA) || roles.includes(ROLES.COORDINADOR) && (this.Rol == ROLES.ADMIN_DOCENCIA || this.Rol == ROLES.COORDINADOR);
    this.getSedes().then(() => {
      this.OutLoading.emit(false);
    });

    this.ubicacionForm = this.builder.group({
      sede: [null, Validators.required],
      edificio: [null, Validators.required],
      salon: [null, Validators.required],
      horas: [null, Validators.required],
      fecha_ini: [null],
      fecha_fin: [null],
    });

    this.ubicacionForm.get("edificio")?.disable();
    this.ubicacionForm.get("salon")?.disable();
    this.ubicacionForm.get("edificio")?.setValue(undefined);
    this.ubicacionForm.get("salon")?.setValue(undefined);
    this.opcionesEdificios = [];
    this.actualizarVisibilidadCargaNoLectiva();
    this.searchTerm$.pipe(distinctUntilChanged()).subscribe((response: any) => {
      this.opcionesSalonesFiltrados = this.opcionesSalones.filter(
        (value, index, array) =>
          value.Nombre.toLowerCase().includes(response.text.toLowerCase())
      );
    });
  }

  event2text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onChangeArchivosSeleccionados(event: Event) {
    const archivosSeleccionados: FileList | null =
      (event.target as HTMLInputElement).files;

    if (!archivosSeleccionados || !archivosSeleccionados.length) {
      return;
    }

    const archivos = Array.from(archivosSeleccionados).filter((archivo) =>
      this.isPdf(archivo)
    );

    if (archivos.length) {
      this.setArchivos(archivos);
    }

    (event.target as HTMLInputElement).value = "";
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const archivosArrastrados: FileList | undefined = event.dataTransfer?.files;

    if (!archivosArrastrados || !archivosArrastrados.length) {
      return;
    }

    const archivos = Array.from(archivosArrastrados).filter((archivo) =>
      this.isPdf(archivo)
    );

    if (archivos.length) {
      this.setArchivos(archivos);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  abrirArchivo(archivo: File | { url?: string }) {
    let url = "";

    if (archivo instanceof File) {
      url = URL.createObjectURL(archivo);
    } else if (archivo?.url) {
      url = archivo.url;
    }

    if (url) {
      window.open(url, "_blank");
    }
  }

  eliminarArchivo(archivo: File | { url?: string; id?: number }) {
    this.archivosSoporte = this.archivosSoporte.filter(
      (item) => item !== archivo
    );
    if ((archivo as any).id) {
      this.archivosIdsExistentes = this.archivosIdsExistentes.filter(
        (id) => id !== (archivo as any).id
      );
    }
    this.archivo = this.archivosSoporte[0] || null;
  }

  validarErrorArchivosSeleccionados(): boolean {
    return !this.archivosSoporte.length;
  }

  private setArchivos(archivos: File[]) {
    this.archivosSoporte = [...this.archivosSoporte, ...archivos];
    this.archivo = this.archivosSoporte[0];
  }

  private isPdf(archivo: File): boolean {
    return (
      archivo.type === "application/pdf" ||
      archivo.name.toLowerCase().endsWith(".pdf")
    );
  }

  validarArchivos(
    archivos: { type?: string; size?: number; name?: string; nombre?: string }[]
  ): string[] {
    const archivosErroneos: string[] = [];
    for (const archivo of archivos) {
      const tipo = (archivo.type || "").toLowerCase();
      const size = archivo.size || 0;
      const name = archivo.name || archivo.nombre || "archivo";

      if (!tipo.includes("pdf")) {
        archivosErroneos.push(`El archivo ${name} no es un PDF.`);
      }
      if (size > 2097152) {
        archivosErroneos.push(
          `El archivo ${name} supera el tamaño máximo de 2 MB.`
        );
      }
    }
    return archivosErroneos;
  }

  async prepararArchivos(archivosFuente?: any[]): Promise<any[]> {
    const idTipoDocument = await this.cargarTipoDocumentoSoporte();

    if (!idTipoDocument) {
      this.popUpManager.showAlert(
        this.translate.instant("GLOBAL.error"),
        this.translate.instant("ptd.guardado_ptd_error")
      );
      return [];
    }

    const archivosBase = archivosFuente ?? this.archivosSoporte;

    if (!archivosBase || archivosBase.length === 0) {
      return [];
    }

    return Promise.all(
      archivosBase.map(async (archivo) => {
        const name = archivo.name ?? archivo.nombre ?? "archivo.pdf";

        let file: File;

        if (archivo instanceof File) {
          file = archivo;
        } else {
          const response = await fetch(archivo.url);
          const blob = await response.blob();
          file = new File(
            [blob],
            name,
            { type: blob.type || archivo.type || "application/pdf" }
          );
        }

        return {
          IdDocumento: idTipoDocument,
          nombre: name.split(".")[0],
          descripcion: "Soporte Plan Docente",
          file: file,
        };
      })
    );
  }

  async cargarArchivos(archivos: any[]): Promise<number[]> {
    return new Promise<number[]>((resolve) => {
      if (!archivos || archivos.length === 0) {
        resolve([]);
        return;
      }

      this.gestorDocumentalService.uploadFiles(archivos).subscribe(
        (respuesta: any[]) => {
          const listaIds = respuesta.map((f) => f.res.Id);
          resolve(listaIds);
        },
        () => {
          this.popUpManager.showAlert(
            this.translate.instant("GLOBAL.error"),
            this.translate.instant("GLOBAL.creacion_documento")
          );
          resolve([]);
        }
      );
    });
  }

  private cargarArchivosDesdeResumen(ids: number[]) {
    if (!ids || ids.length === 0) {
      this.archivosSoporte = [];
      this.archivo = null;
      return;
    }

    const idsForQuery = ids.join("|");
    const limitQuery = ids.length;

    this.gestorDocumentalService
      .getManyFiles(`?query=Id__in:${idsForQuery}&limit=${limitQuery}`)
      .subscribe(
        (docs: any[]) => {
          if (!Array.isArray(docs)) {
            return;
          }

          const archivos = docs
            .filter(Boolean)
            .map((doc: any) => ({
              id: doc.Id,
              nombre: doc.Nombre,
              url: doc.Url,
              type: doc.TipoArchivo || "application/pdf",
              size: 0,
            }));
          this.archivosSoporte = archivos;
          this.archivo = this.archivosSoporte[0] || null;
        },
        () => {
          this.popUpManager.showAlert(
            this.translate.instant("GLOBAL.error"),
            this.translate.instant("GLOBAL.carga_documento")
          );
        }
      );
  }

  habilitarSelectFechas() {
    this.manageByTime = !this.manageByTime;
    const validador = this.manageByTime ? Validators.required : null;
    this.ubicacionForm.get("fecha_ini")?.setValidators(validador);
    this.ubicacionForm.get("fecha_ini")?.updateValueAndValidity();
    this.ubicacionForm.get("fecha_fin")?.setValidators(validador);
    this.ubicacionForm.get("fecha_fin")?.updateValueAndValidity();
  }

  async ngOnChanges() {
    if (this.Data) {
      this.edit = this.WorkingMode == ACTIONS.EDIT;
      this.vinculaciones = this.Data.tipo_vinculacion;
      this.seleccion = this.Data.seleccion;
      this.vinculacionSelected = this.vinculaciones[this.seleccion];
      this.asignaturas = this.Data.espacios_academicos[this.seleccion];
      this.observacion = this.Data.resumenes[this.seleccion].observacion
        ? this.Data.resumenes[this.seleccion].observacion
        : "";
      this.observacionArchivo = this.Data.resumenes[this.seleccion].observacionArchivo
        ? this.Data.resumenes[this.seleccion].observacionArchivo
        : "";
      const archivosResumen = this.Data.resumenes[this.seleccion]?.archivo;
      this.archivosIdsExistentes = Array.isArray(archivosResumen)
        ? archivosResumen
        : [];
      this.cargarArchivosDesdeResumen(this.archivosIdsExistentes);
      this.calcularHoras();
      this.calcularHoras(this.tipo.actividades);
      this.calcularHoras(this.tipo.carga_lectiva);
      await this.getActividades();
      this.loadCarga();
      await this.setPuedeEditarPTD();
      this.bloquearElementosTabla();
    } else {
      this.listaCargaLectiva = [];
    }
  }



  getDragPosition(eventDrag: CdkDragMove) {
    const contenedor: DOMRect =
      this.contenedorCargaLectiva.nativeElement.getBoundingClientRect();
    let posicionRelativa = {
      x: Math.floor(
        eventDrag.pointerPosition.x - contenedor.left - this.snapGridSize.x / 2
      ),
      y: Math.floor(
        eventDrag.pointerPosition.y - contenedor.top - this.snapGridSize.ymin
      ),
    };
    posicionRelativa.x = posicionRelativa.x <= 0 ? 0 : posicionRelativa.x;
    posicionRelativa.y = posicionRelativa.y <= 0 ? 0 : posicionRelativa.y;
    posicionRelativa.x =
      Math.round(posicionRelativa.x / this.snapGridSize.x) *
      this.snapGridSize.x;
    posicionRelativa.y =
      Math.round(posicionRelativa.y / this.snapGridSize.ymin) *
      this.snapGridSize.ymin;
    return posicionRelativa;
  }

  chechkUsedRegion(x: number, y: number, h: number) {
    const ymax = y + h / this.horarioSize.stepHour;
    let busy = false;
    for (let index = y; index < ymax; index++) {
      if (this.matrixBusy[x][index]) {
        busy = true;
        break;
      }
    }
    return busy;
  }

  changeStateRegion(x: number, y: number, h: number, state: boolean) {
    const ymax = y + h / this.horarioSize.stepHour;
    for (let index = y; index < ymax; index++) {
      this.matrixBusy[x][index] = state;
    }
  }

  isInsideGrid(element: CardDetalleCarga) {
    const left = 0 <= element.finalPosition.x;
    const right = element.finalPosition.x < this.containerGridsize.x;
    const top = 0 <= element.finalPosition.y;
    const bottom = element.finalPosition.y < this.containerGridsize.y;
    return left && right && top && bottom;
  }

  getPositionforMatrix(element: CardDetalleCarga) {
    const x = Math.floor(element.finalPosition.x / this.snapGridSize.x);
    const y = Math.floor(element.finalPosition.y / this.snapGridSize.ymin);
    return { x, y };
  }

  onDragMoved(event: CdkDragMove, elementMoved: CardDetalleCarga) {
    if (!this.dragEnabled) {
      event.source._dragRef.setFreeDragPosition(elementMoved.prevPosition);
      return;
    }

    if (this.isInsideGrid(elementMoved)) {
      const coord = this.getPositionforMatrix(elementMoved);
      this.changeStateRegion(coord.x, coord.y, elementMoved.horas, false);
    }
    const posicionRelativa = this.getDragPosition(event);
    const x = posicionRelativa.x / this.snapGridSize.x;
    const y = posicionRelativa.y / this.snapGridSize.ymin;
    const ocupado = this.chechkUsedRegion(x, y, elementMoved.horas);
    if (ocupado) {
      elementMoved.dragPosition = elementMoved.prevPosition;
      event.source._dragRef.setFreeDragPosition(elementMoved.prevPosition);
      event.source._dragRef.disabled = true;
      elementMoved.estado = this.estado.ocupado;
    } else {
      elementMoved.dragPosition = posicionRelativa;
      elementMoved.estado = this.estado.ubicado;
    }
    if (
      posicionRelativa.x != elementMoved.prevPosition.x ||
      posicionRelativa.y != elementMoved.prevPosition.y
    ) {
      elementMoved.prevPosition = elementMoved.dragPosition;
      elementMoved.horaFormato = this.calculateTimeSpan(
        elementMoved.dragPosition,
        elementMoved.horas
      );
    }
  }

  onDragStarted(elementMoved: CardDetalleCarga) {
    this.listaColocacionesModuloHorario = [];
    this.cargarRestriccionesDeHorario(elementMoved);
  }

  async cargarRestriccionesDeHorario(elementMoved: CardDetalleCarga) {
    this.banderaInfoNoSoltarTarjeta = true;
    this.dragEnabled = false;
    //await this.cargarRestricionesGrupoEstudio(elementMoved);
    await this.cargarRestricionesEspaciosFisicos(elementMoved);
    this.dragEnabled = true;
    this.banderaInfoNoSoltarTarjeta = false;
  }

  async cargarRestricionesEspaciosFisicos(
    elementMoved: CardDetalleCarga
  ): Promise<void> {

    const periodoAcademico = (this.Data?.periodo_academico || "").trim();
    const [anio, periodo] = periodoAcademico.split("-");
    const periodoId = periodoAcademico.replace("-", "/");
    const espacioFisicoId = elementMoved?.salon?.id;

    if (!espacioFisicoId || !anio || !periodo) {
      console.warn("Datos insuficientes para cargar restricciones físicas");
      return;
    }
    try {
      const res: any = await this.academicaJbpmService
        .get(`cursos_salon/${periodoId}/${espacioFisicoId}`)
        .toPromise();

      const cursos = res?.cursos?.curso;

      if (!Array.isArray(cursos) || cursos.length === 0) {
        return;
      }

      const requests: Promise<any>[] = [];

      for (const curso of cursos) {

        if (!curso.codigo_curso || !curso.grupos) continue;

        const grupos = curso.grupos
          .split(",")
          .map((g: string) => g.trim())
          .filter((g: string) => g.length > 0);

        for (const grupo of grupos) {

          const request = this.planDocenteMid
            .get(
              `espacio-academico/informacion-horarios/${anio}/${periodo}/${curso.codigo_curso}/${grupo}`
            )
            .toPromise()
            .catch(() => null); // evita que falle todo el Promise.all

          requests.push(request);
        }
      }

      if (requests.length === 0) return;

      const responses = await Promise.all(requests);
      const colocacionesFiltradas = responses
        .filter(res => res?.Success && Array.isArray(res?.Data))
        .flatMap(res => res.Data)
        .filter(colocacion =>
          colocacion?.
            ResumenColocacionEspacioFisico?.
            espacio_fisico?.
            salon?.
            CodigoAbreviacion === espacioFisicoId
        );
      if (colocacionesFiltradas.length > 0) {
        this.agregarRestriccionesAlHorario(
          colocacionesFiltradas,
          { espacioFisico: true }
        );
      }

    } catch (error) {
      console.error("Error cargando restricciones por espacio físico", error);
    }
  }

  async cargarRestricionesGrupoEstudio(
    elementMoved: CardDetalleCarga
  ): Promise<void> {
    const espacioAcademicoId = elementMoved?.idEspacioAcademico!;
    if (!espacioAcademicoId || espacioAcademicoId === "NA") {
      return;
    }

    const periodoId = this.Data.vigencia;
    const resEspacio: any = await this.espacioAcademicoService
      .get(`espacio-academico/${espacioAcademicoId}`)
      .toPromise();

    const grupoEstudioId = resEspacio.Data?.grupo_estudio_id;

    if (!grupoEstudioId || grupoEstudioId === 0 || grupoEstudioId === "0") {
      console.warn("grupoEstudioId inválido:", grupoEstudioId);
      return;
    }
    const resColocacion: any = await this.horarioMid
      .get(
        `colocacion-espacio-academico/sin-detalles?grupo-estudio-id=${grupoEstudioId}&periodo-id=${periodoId}`
      )
      .toPromise();

    if (resColocacion.Data && resColocacion.Data.length > 0) {
      this.agregarRestriccionesAlHorario(resColocacion.Data, {
        grupoEstudio: true,
      });
    }
  }

  agregarRestriccionesAlHorario(
    colocaciones: any[],
    options: { grupoEstudio?: boolean; espacioFisico?: boolean }
  ): void {
    colocaciones.forEach((element: any) => {
      const ocupado: any = {
        id: element._id,
        horas: element.ColocacionEspacioAcademico.horas,
        estado: this.estado.ubicado,
        dragPosition: element.ColocacionEspacioAcademico.finalPosition,
        prevPosition: element.ColocacionEspacioAcademico.finalPosition,
        finalPosition: element.ColocacionEspacioAcademico.finalPosition,
        //se pone true dependiendo del tipo de restriccion
        grupoEstudio: options.grupoEstudio || false,
        espacioFisico: options.espacioFisico || false,
      };
      if (
        !this.listaCargaLectiva.some(
          (carga) => carga.idColocacionEspacioAcademico === element._id
        )
      ) {
        const exists = this.listaRestriccionesHorario.some(
          (restriccion) => restriccion.id === ocupado.id
        );

        if (!exists) {
          const coord = this.getPositionforMatrix(ocupado);
          this.changeStateRegion(coord.x, coord.y, ocupado.horas, true);
          this.listaRestriccionesHorario.push(ocupado);
        }
      }
    });
  }

  calculateTimeSpan(dragPosition: CoordXY, h: number): string {
    const iniTimeRaw =
      dragPosition.y / this.snapGridSize.y + this.horarioSize.hourIni;
    const finTimeRaw = iniTimeRaw + h;
    const horaI = Math.floor(iniTimeRaw);
    const minI = (iniTimeRaw - horaI) * 60;
    const horaF = Math.floor(finTimeRaw);
    const minF = (finTimeRaw - horaF) * 60;
    return (
      String(horaI).padStart(2, "0") +
      ":" +
      String(minI).padEnd(2, "0") +
      " - " +
      String(horaF).padStart(2, "0") +
      ":" +
      String(minF).padEnd(2, "0")
    );
  }

  onDragReleased(event: CdkDragRelease, elementMoved: CardDetalleCarga) {
    this.limpiarListaEspaciosFisicosOcupados();
    if (!this.dragEnabled) {
      elementMoved.dragPosition = elementMoved.prevPosition;
      elementMoved.finalPosition = elementMoved.prevPosition;
      event.source._dragRef.setFreeDragPosition(elementMoved.prevPosition);
      return;
    }

    this.popUpManager
      .showPopUpGeneric(
        this.translate.instant("ptd.asignar"),
        this.translate.instant("ptd.ask_mover") +
        "<br>" +
        elementMoved.horaFormato +
        "?",
        MODALS.QUESTION,
        true
      )
      .then((action) => {
        if (action.value) {
          elementMoved.estado = this.estado.ubicado;
          elementMoved.finalPosition = elementMoved.dragPosition;
          if (this.isInsideGrid(elementMoved)) {
            const coord = this.getPositionforMatrix(elementMoved);
            this.changeStateRegion(coord.x, coord.y, elementMoved.horas, true);
          }
        } else {
          if (this.isInsideGrid(elementMoved)) {
            const coord = this.getPositionforMatrix(elementMoved);
            this.changeStateRegion(coord.x, coord.y, elementMoved.horas, true);
          }
          elementMoved.dragPosition = elementMoved.finalPosition;
          elementMoved.prevPosition = elementMoved.dragPosition;
          elementMoved.finalPosition = elementMoved.dragPosition;
          event.source._dragRef.setFreeDragPosition(elementMoved.prevPosition);
          event.source._dragRef.disabled = true;
          event.source
            .getRootElement()
            .scrollIntoView({ block: "center", behavior: "smooth" });
        }
        this.cdr.detectChanges();
      });
  }

  async formularioEspacioFisico() {
    if (this.asignaturaSelected) {
      this.planDocenteMid
        .get(
          "espacio-fisico/dependencia?dependencia=" +
          this.asignaturaSelected.proyecto_id
        )
        .subscribe(
          (res) => {
            if (res.Data.PorAsignar) {
              this.popUpManager.showPopUpGeneric(
                this.translate.instant("ptd.espacio_fisico"),
                this.translate.instant("ptd.proyecto_sin_espacios"),
                MODALS.WARNING,
                false
              );
            }
            this.EspaciosProyecto = res.Data;
            /*this.opcionesSedes = this.normalizarListaEspacios(
              this.EspaciosProyecto?.Sedes
            );
            this.opcionesEdificios = this.normalizarListaEspacios(
              this.EspaciosProyecto?.Edificios
            );*/
            /*this.opcionesSalones = this.normalizarListaEspacios(
              this.EspaciosProyecto?.Salones
            );*/
            this.opcionesSalonesFiltrados = this.opcionesSalones;
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
    this.ubicacionActive = true;
  }

  cancelarUbicacion() {
    this.ubicacionForm.reset();
    this.ubicacionActive = false;
    const x = this.snapGridSize.x * -2.25;
    const y = 0;
    this.editandoAsignacion = {
      id: null,
      nombre: "",
      idCarga: null,
      idEspacioAcademico: null,
      idActividad: null,
      horas: 0,
      horaFormato: null,
      tipo: null,
      sede: null,
      edificio: null,
      salon: null,
      estado: null,
      bloqueado: true,
      dragPosition: { x, y },
      prevPosition: { x, y },
      finalPosition: { x, y },
    };
  }

  addCarga() {
    const h = Number(this.ubicacionForm.get("horas")?.value);
    const salon = this.opcionesSalonesFiltrados.find(
      (opcion) => opcion.nombre == this.ubicacionForm.get("salon")?.value
    );
    const x = this.snapGridSize.x * -2.25;
    const y = 0;

    if (!this.editandoAsignacion.id) {
      this.identificador++;
      const newElement: CardDetalleCarga = {
        id: this.identificador,
        nombre: this.isDocente
          ? this.actividadSelected.nombre
          : this.asignaturaSelected.nombre,
        idCarga: null,
        idEspacioAcademico: this.isDocente ? null : this.asignaturaSelected.id,
        idActividad: this.isDocente ? this.actividadSelected._id : null,
        sede: this.ubicacionForm.get("sede")?.value,
        edificio: this.ubicacionForm.get("edificio")?.value
          ? this.ubicacionForm.get("edificio")?.value
          : "NA",
        salon: salon || "NA",
        horas: h,
        horaFormato: "",
        tipo: this.isDocente ? this.tipo.actividades : this.tipo.carga_lectiva,
        estado: this.estado.flotando,
        bloqueado: false,
        dragPosition: { x: x, y: y },
        prevPosition: { x: x, y: y },
        finalPosition: { x: x, y: y },
      };
      this.listaCargaLectiva.push(newElement);
    } else {
      if (this.isInsideGrid(this.editandoAsignacion)) {
        const coord = this.getPositionforMatrix(this.editandoAsignacion);
        this.changeStateRegion(
          coord.x,
          coord.y,
          this.editandoAsignacion.horas,
          false
        );
      }
      this.editandoAsignacion.horas = h;
      this.editandoAsignacion.sede = this.ubicacionForm.get("sede")?.value;
      this.editandoAsignacion.edificio = this.ubicacionForm.get("edificio")
        ?.value
        ? this.ubicacionForm.get("edificio")?.value
        : "NA";
      this.editandoAsignacion.salon = salon || "NA";
      this.editandoAsignacion.dragPosition = { x: x, y: y };
      this.editandoAsignacion.prevPosition =
        this.editandoAsignacion.dragPosition;
      this.editandoAsignacion.finalPosition =
        this.editandoAsignacion.dragPosition;
      this.editandoAsignacion.estado = this.estado.flotando;
    }

    this.cancelarUbicacion();
  }

  loadCarga() {
    this.listaCargaLectiva = [];

    this.Data.carga[this.seleccion].forEach((carga: any) => {
      this.identificador++;
      let nombre;
      if (carga.espacio_academico_id != "NA") {
        nombre = this.obtenerNombreEspacioAcademicoPorId(
          carga?.espacio_academico_id,
          carga?.espacio_academico_nombre || carga?.espacio_academico
        );
      } else {
        nombre = this.actividades.find(
          (actividad) => actividad._id == carga.actividad_id
        )?.nombre;
      }

      const newElement: CardDetalleCarga = {
        id: this.identificador,
        nombre: nombre,
        idCarga: carga.id,
        idEspacioAcademico: carga.espacio_academico_id,
        idColocacionEspacioAcademico: carga.colocacion_espacio_academico_id,
        idActividad: carga.actividad_id,
        horas: carga.horario.horas,
        horaFormato: carga.horario.horaFormato,
        tipo: carga.horario.tipo,
        sede: carga.sede,
        edificio: carga.edificio,
        salon: carga.salon,
        estado: carga.horario.estado,
        bloqueado:
          !this.edit ||
          (this.isDocente && carga.horario.tipo == this.tipo.carga_lectiva) ||
          (this.isCoordinador && carga.horario.tipo == this.tipo.actividades),
        dragPosition: carga.horario.dragPosition,
        prevPosition: carga.horario.prevPosition,
        finalPosition: carga.horario.finalPosition,
      };

      if (this.Data.docentesModular) {
        newElement.modular = true;
        newElement.docente_id = carga.docente_id;
        newElement.docenteName =
          this.Data.docentesModular[carga.docente_id].NombreCorto;
      }

      this.listaCargaLectiva.push(newElement);
      this.resolverNombreEspacioEnElemento(newElement, carga);
      const coord = this.getPositionforMatrix(newElement);
      this.changeStateRegion(coord.x, coord.y, newElement.horas, true);
    });
  }

  async editElement(elementClicked: CardDetalleCarga) {
    if (elementClicked.bloqueado) {
      return;
    }
    this.ubicacionActive = true;

    if (this.isInsideGrid(elementClicked)) {
      const coord = this.getPositionforMatrix(elementClicked);
      this.changeStateRegion(coord.x, coord.y, elementClicked.horas, false);
    }

    const normalizeStr = (str: any) => {
      if (!str) return "";
      return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    };

    this.sede = this.opcionesSedes.find(
      (opcion) => {
        if (!opcion || !elementClicked.sede) return false;

        if (typeof elementClicked.sede === 'string') {
          const val = normalizeStr(elementClicked.sede);
          const opcionId = opcion.sede_id || opcion.Id || opcion.id || opcion.codigo;
          const opcionNombre = opcion.sede || opcion.Nombre || opcion.nombre;

          if (opcionId && normalizeStr(opcionId) === val) return true;
          if (opcionNombre && normalizeStr(opcionNombre) === val) return true;
          return false;
        }

        const opcionIds = [opcion.sede_id, opcion.Id, opcion.id, opcion.codigo].filter(Boolean).map(x => normalizeStr(x));
        const clickedIds = [elementClicked.sede.sede_id, elementClicked.sede.Id, elementClicked.sede.id, elementClicked.sede.CodigoAbreviacion].filter(Boolean).map(x => normalizeStr(x));

        const hasIdMatch = opcionIds.some(id => clickedIds.includes(id));
        if (hasIdMatch) return true;

        const opcionNombres = [opcion.sede, opcion.Nombre, opcion.nombre].filter(Boolean).map(normalizeStr);
        const clickedNombres = [elementClicked.sede.Nombre, elementClicked.sede.nombre, elementClicked.sede.sede].filter(Boolean).map(normalizeStr);

        const hasNameMatch = opcionNombres.some(name => clickedNombres.includes(name));
        if (hasNameMatch) return true;

        return false;
      }
    );
    this.ubicacionForm.get("sede")?.setValue(this.sede);
    this.cambioSede().then(() => {
      this.edificio = this.opcionesEdificios.find(
        (opcion) => {
          if (!opcion || !elementClicked.edificio) return false;

          if (typeof elementClicked.edificio === 'string') {
            const val = normalizeStr(elementClicked.edificio);
            const opcionCodigo = opcion.codigo || opcion.Codigo || opcion.Id || opcion.id || opcion.CodigoAbreviacion;
            const opcionNombre = opcion.nombre || opcion.Nombre;

            if (opcionCodigo && normalizeStr(opcionCodigo) === val) return true;
            if (opcionNombre && normalizeStr(opcionNombre) === val) return true;
            return false;
          }

          const opcionCodigos = [opcion.codigo, opcion.Codigo, opcion.Id, opcion.id, opcion.CodigoAbreviacion].filter(Boolean).map(x => normalizeStr(x));
          const clickedCodigos = [elementClicked.edificio.codigo, elementClicked.edificio.Codigo, elementClicked.edificio.Id, elementClicked.edificio.id, elementClicked.edificio.CodigoAbreviacion].filter(Boolean).map(x => normalizeStr(x));

          const hasCodeMatch = opcionCodigos.some(c => clickedCodigos.includes(c));
          if (hasCodeMatch) return true;

          const opcionNombres = [opcion.nombre, opcion.Nombre].filter(Boolean).map(normalizeStr);
          const clickedNombres = [elementClicked.edificio.nombre, elementClicked.edificio.Nombre].filter(Boolean).map(normalizeStr);

          const hasNameMatch = opcionNombres.some(name => clickedNombres.includes(name));
          if (hasNameMatch) return true;

          return false;
        }
      );
      this.ubicacionForm.get("edificio")?.setValue(this.edificio);
      this.cambioEdificio().then(() => {
        const salonNombre = typeof elementClicked.salon === 'string'
          ? elementClicked.salon
          : (elementClicked.salon?.nombre || elementClicked.salon?.Nombre || "");
        this.ubicacionForm.get("salon")?.setValue(salonNombre);
      });
    });
    this.ubicacionForm.get("horas")?.setValue(elementClicked.horas);
    this.editandoAsignacion = elementClicked;

    // Autocompletar la asignatura o actividad
    if (elementClicked.idEspacioAcademico && elementClicked.idEspacioAcademico !== 'NA') {
      this.asignaturaSelected = this.asignaturas.find(
        (a) => a.id == elementClicked.idEspacioAcademico || a.codigo == elementClicked.idEspacioAcademico
      );
    } else if (elementClicked.idActividad && elementClicked.idActividad !== 'NA') {
      this.actividadSelected = this.actividades.find(
        (act) => act._id == elementClicked.idActividad || act.id == elementClicked.idActividad
      );
    }

    // Esperar a que se muestre el contenedor
    const c: Element | null = document.getElementById("ubicacion");
    if (c) {
      await new Promise((f) => setTimeout(f, 10)); // asegurar que el DOM esté actualizado
      c.scrollIntoView({ behavior: "smooth" });
    }
  }

  deleteElement(htmlElement: any, elementClicked: CardDetalleCarga) {
    console.log(elementClicked);
    if (elementClicked.bloqueado) {
      return;
    }

    this.popUpManager
      .showPopUpGeneric(
        this.translate.instant("ptd.borrar"),
        this.translate.instant("ptd.ask_borrar"),
        MODALS.QUESTION,
        true
      )
      .then((action) => {
        if (action.value) {
          this.OutLoading.emit(true);
          if (this.isInsideGrid(elementClicked)) {
            const coord = this.getPositionforMatrix(elementClicked);
            this.changeStateRegion(
              coord.x,
              coord.y,
              elementClicked.horas,
              false
            );
          }
          const idx = this.listaCargaLectiva.findIndex(
            (element) => element.id == elementClicked.id
          );
          this.listaCargaLectiva.splice(idx, 1);
          if (elementClicked.idCarga) {
            this.horarioMid
              .delete(
                "colocacion-espacio-academico",
                elementClicked.idColocacionEspacioAcademico
              )
              .subscribe((response: any) => {
                if (response.Success) {
                  this.OutLoading.emit(false);
                  this.DataChanged.emit(this.listaCargaLectiva);
                  this.popUpManager.showSuccessAlert(
                    this.translate.instant("ptd.colocacion_eliminada")
                  );
                  this.cdr.detectChanges();
                }
              });
          } else {
            this.OutLoading.emit(false);
            this.cdr.detectChanges();
          }

          // Obtener el contenedor y verificar la relación padre-hijo
          const c: Element = this.contenedorCargaLectiva.nativeElement;

          // Asegurarse de que el elemento a eliminar está dentro del contenedor
          let parentElement = htmlElement.parentElement;
          let isChild = false;

          while (parentElement) {
            if (parentElement === c) {
              isChild = true;
              break;
            }
            parentElement = parentElement.parentElement;
          }

          if (
            isChild &&
            htmlElement.parentElement &&
            htmlElement.parentElement.parentElement
          ) {
            try {
              c.removeChild(htmlElement.parentElement.parentElement);
            } catch (error) {
              // no hacer nada
            }
          }
        }
      });
  }

  calcularHoras(tipo?: number) {
    let total = 0;
    this.listaCargaLectiva.forEach((carga: CardDetalleCarga) => {
      if (this.isInsideGrid(carga) && !carga.modular) {
        if (tipo) {
          if (carga.tipo == tipo) {
            total += carga.horas;
          }
        } else {
          total += carga.horas;
        }
      }
    });
    return total;
  }

  toggleDetalleActividades() {
    this.mostrarDetalleActividades = !this.mostrarDetalleActividades;
  }

  obtenerActividadesNoLectivas() {
    const actividadesFiltradas = this.listaCargaLectiva.filter(
      (carga: CardDetalleCarga) =>
        carga.tipo === this.tipo.actividades &&
        this.isInsideGrid(carga) &&
        !carga.modular
    );

    // Agrupar por nombre de actividad y sumar horas
    const actividadesAgrupadas = new Map<string, any>();

    actividadesFiltradas.forEach((actividad: CardDetalleCarga) => {
      const nombre = String(actividad.nombre || '').trim();
      if (nombre) {
        if (actividadesAgrupadas.has(nombre)) {
          const existente = actividadesAgrupadas.get(nombre);
          existente.horas += actividad.horas;
        } else {
          actividadesAgrupadas.set(nombre, {
            nombre: nombre,
            horas: actividad.horas
          });
        }
      }
    });

    return Array.from(actividadesAgrupadas.values());
  }

  async guardar_ptd() {
    const periodoId = this.Data.vigencia;
    if (!this.puedeEditarPTD || this.esModoVistaLecturaEstricta) {
      this.popUpManager.showAlert(
        this.translate.instant("ptd.guardado_ptd_error"),
        this.translate.instant("ptd.guardado_ptd_error_msg")
      );
      return;
    }
    this.OutLoading.emit(true);

    const erroresArchivos = this.validarArchivos(this.archivosSoporte);
    if (erroresArchivos.length) {
      this.OutLoading.emit(false);
      this.popUpManager.showAlert(
        this.translate.instant("GLOBAL.error"),
        erroresArchivos.join("\n")
      );
      return;
    }

    const archivosNuevos = this.archivosSoporte.filter((a) => !a.id);
    const archivosAEnviar = await this.prepararArchivos(archivosNuevos);
    const idsArchivosNuevos = await this.cargarArchivos(archivosAEnviar);
    const idsArchivos = [
      ...this.archivosIdsExistentes,
      ...idsArchivosNuevos,
    ];
    let carga_plan = [];
    console.log(this.listaCargaLectiva)
    let totalHorasLectivas = 0;
    let totalHorasPCCTE = 0;
    for (const element of this.listaCargaLectiva) {
      let horaInicio = parseInt(element.horaFormato.split(":")[0]);
      if (element.tipo === 1) {
        totalHorasLectivas += Number(element.horas);
      }
      if (element.tipo === 2) {
        const actividad = this.actividades.find(
          (a: any) => a._id === element.idActividad
        );
        const codigo = actividad?.codigo_abreviacion;

        if (codigo === "PCCTE") {
          totalHorasPCCTE += Number(element.horas);
        }
      }
      if (!element.bloqueado) {
        const sedeId =
          element.sede?.sede_id || element.sede?.Id || element.sede?.id || "";
        const edificioId =
          element.edificio?.codigo ||
          element.edificio?.Id ||
          element.edificio?.id ||
          "";
        const salonId =
          element.salon?.id || element.salon?.Id || element.salon?.codigo || "";

        carga_plan.push({
          id: element.idCarga,
          espacio_academico_id: element.idEspacioAcademico,
          espacio_academico_nombre: element.nombre,
          actividad_id: element.idActividad,
          colocacion_id:
            element.idCarga === "colocacionModuloHorario"
              ? ""
              : element.idColocacionEspacioAcademico,
          periodo_id: periodoId,
          plan_docente_id: this.Data.plan_docente[this.seleccion],
          sede_id: sedeId,
          edificio_id: edificioId,
          salon_id: salonId,
          horario: {
            horas: element.horas,
            horaFormato: element.horaFormato,
            tipo: element.tipo,
            estado: element.estado,
            dragPosition: element.dragPosition,
            prevPosition: element.prevPosition,
            finalPosition: element.finalPosition,
          },
          hora_inicio: horaInicio,
          duracion: element.horas,
          activo: true,
        });
      }
    }

    const estado_plan_is = this.Data.estado_plan[this.seleccion];

    let plan_docente = {
      id: this.Data.plan_docente[this.seleccion],
      resumen: JSON.stringify({
        horas_lectivas: this.calcularHoras(this.tipo.carga_lectiva),
        horas_actividades: this.calcularHoras(this.tipo.actividades),
        archivo: idsArchivos,
        observacionArchivo: this.observacionArchivo,
        observacion: this.observacion,
      }),
      estado_plan: estado_plan_is,
    };
    if (totalHorasPCCTE >= totalHorasLectivas * 0.5) {
      this.OutLoading.emit(false);
      this.popUpManager.showErrorAlert(
        "Las horas de preparacion de clase no pueden superar la mitad de la cantidad de horas lectivas."
      );
      return;
    }
    this.planDocenteMid
      .put("plan/", {
        carga_plan: carga_plan,
        plan_docente: plan_docente,
        descartar: this.Data.descartar ? this.Data.descartar : [],
      })
      .subscribe((response) => {
        this.OutLoading.emit(false);
        if (response.Status == 200) {
          this.popUpManager.showSuccessAlert(
            this.translate.instant("ptd.guardado_ptd_exito") +
            " " +
            this.vinculacionSelected.nombre
          );
          this.DataChanged.emit(this.listaCargaLectiva);
          this.cdr.detectChanges();
        }
      });
  }

  async selectVinculacion(event: any) {
    this.asignaturaSelected = undefined;
    if (event.value == undefined) {
      this.asignaturas = [];
    } else {
      for (let index = 0; index < this.vinculaciones.length; index++) {
        const element = this.vinculaciones[index];
        if (element == event.value) {
          this.seleccion = index;
          this.asignaturas = this.Data.espacios_academicos[this.seleccion];
        }
      }
    }
    this.actualizarVisibilidadCargaNoLectiva();
    this.blockcargas();
  }

  async actualizarVisibilidadCargaNoLectiva() {
    if (!this.isDocente || !this.vinculacionSelected) {
      this.mostrarSelectorActividadesNoLectivas = false;
      this.actividadSelected = undefined;
      return;
    }
    const codigosAbreviacion = await this.obtenerCodigoAbreviacionVinculacion();
    this.mostrarSelectorActividadesNoLectivas = this.esCodigoVinculacionConCargaNoLectiva(codigosAbreviacion);
    if (!this.mostrarSelectorActividadesNoLectivas) {
      this.actividadSelected = undefined;
    }
  }

  esCodigoVinculacionConCargaNoLectiva(codigoAbreviacion: string | null): boolean {
    if (!codigoAbreviacion) {
      return false;
    }
    const codigoNormalizado = String(codigoAbreviacion).trim().toUpperCase();
    return (
      this.TIEMPO_COMPLETO.includes(codigoNormalizado) ||
      this.MEDIO_TIEMPO.includes(codigoNormalizado)
    );
  }

  async obtenerCodigoAbreviacionVinculacion(): Promise<string> {
    if (!this.vinculacionSelected?.id) {
      return "";
    }
    try {
      const parametroResp: any = await firstValueFrom(
        this.parametrosService.get(
          `parametro?query=Id:${this.vinculacionSelected?.id}&fields=CodigoAbreviacion`
        )
      );
      return String(
        parametroResp?.Data?.[0]?.CodigoAbreviacion || ""
      ).trim();
    } catch (error) {
      console.warn(
        "No fue posible obtener código de abreviación para vinculación",
        this.vinculacionSelected?.id,
        error
      );
      throw error;
    }
  }

  blockcargas() {
    this.listaCargaLectiva.forEach((element: CardDetalleCarga) => {
      if (this.asignaturas.find((asignatura) => asignatura.id == element.id)) {
        element.bloqueado = false;
      } else {
        element.bloqueado = true;
      }
    });
  }

  getSedes() {
    return new Promise((resolve, reject) => {
      this.academicaJbpmService
        .get(
          "sedes"
        )
        .subscribe(
          (res) => {
            const rawSedes = res?.sedes?.sede;
            this.opcionesSedes = Array.isArray(rawSedes) ? rawSedes : (rawSedes ? [rawSedes] : []);
            resolve(res);
          },
          (err) => {
            reject(err);
          }
        );
    });
  }

  cambioSede() {
    this.opcionesEdificios = [];
    this.opcionesSalones = [];
    this.opcionesSalonesFiltrados = [];
    const sedeSeleccionada = this.ubicacionForm.get("sede")?.value;
    this.ubicacionForm.get("edificio")?.disable();
    this.ubicacionForm.get("salon")?.disable();
    this.ubicacionForm.get("edificio")?.setValue(undefined);
    this.ubicacionForm.get("salon")?.setValue(undefined);
    return new Promise((resolve, reject) => {
      /*if (this.asignaturaSelected) {
        this.opcionesEdificios = this.obtenerEdificiosDesdeProyecto();
        if (this.opcionesEdificios.length > 0) {
          this.ubicacionForm.get("edificio")?.enable();
        }
        resolve(this.opcionesEdificios);
      } else {*/
      const sedeId = sedeSeleccionada?.sede_id || (typeof sedeSeleccionada === 'string' ? sedeSeleccionada : null);
      if (!sedeId || sedeId === 'null') {
        resolve([]);
        return;
      }
      this.academicaJbpmService
        .get(
          "edificios/" + sedeId
        )
        .subscribe(
          (res) => {
            const rawEdificios = res?.edificios?.edificio;
            this.opcionesEdificios = Array.isArray(rawEdificios) ? rawEdificios : (rawEdificios ? [rawEdificios] : []);
            this.ubicacionForm.get("edificio")?.enable();
            resolve(res);
          },
          (err) => {
            console.warn("cambioSede error", err);
            resolve([]);
          }
        );
    }
    /*}*/);
  }

  cambioEdificio() {
    this.opcionesSalones = [];
    this.opcionesSalonesFiltrados = [];
    this.ubicacionForm.get("salon")?.disable();
    this.ubicacionForm.get("salon")?.setValue(undefined);
    /*if (this.asignaturaSelected) {
      this.opcionesSalones = this.obtenerSalonesDesdeProyecto();
      this.opcionesSalonesFiltrados = this.opcionesSalones;
      if (this.opcionesSalones.length > 0) {
        this.ubicacionForm.get("salon")?.enable();
      }
    } else {*/
    const edificioSeleccionado = this.ubicacionForm.get("edificio")?.value;
    const edificioCodigo = edificioSeleccionado?.codigo || (typeof edificioSeleccionado === 'string' ? edificioSeleccionado : null);

    return new Promise<any>((resolve) => {
      if (!edificioCodigo || edificioCodigo === 'null') {
        resolve([]);
        return;
      }
      this.academicaJbpmService
        .get(
          "salones/" + edificioCodigo
        )
        .subscribe(
          (res) => {
            const rawSalones = res?.salones?.salon;
            this.opcionesSalones = Array.isArray(rawSalones) ? rawSalones : (rawSalones ? [rawSalones] : []);
            this.opcionesSalonesFiltrados = this.opcionesSalones;
            this.ubicacionForm.get("salon")?.enable();
            resolve(res);
          },
          (err) => {
            console.warn("cambioEdificio error", err);
            resolve([]);
          }
        );
    });
    /*}*/
  }

  cambioSalon(element: any) {
    this.salon = element.option.value;
    this.ubicacionForm.get("salon")?.setValue(this.salon.nombre);
  }

  getActividades() {
    return new Promise((resolve, reject) => {
      this.planDocenteService
        .get("actividad?query=activo:true&fields=nombre,codigo_abreviacion")
        .subscribe(
          (res: any) => {
            this.actividades = res.Data;
            resolve(res);
          },
          (err) => {
            reject(err);
          }
        );
    });
  }

  limpiarListaEspaciosFisicosOcupados() {
    if (this.listaRestriccionesHorario.length > 0) {
      this.listaRestriccionesHorario.forEach((ocupado) => {
        const coord = this.getPositionforMatrix(ocupado);
        this.changeStateRegion(coord.x, coord.y, ocupado.horas, false);
      });
      this.listaRestriccionesHorario = [];
    }
  }

  getEstadoPDT(): Promise<any | null> {
    return new Promise((resolve, reject) => {
      this.planDocenteService
        .get(`plan_docente/${this.Data.plan_docente[this.seleccion]}`)
        .subscribe(
          (response: any) => {
            if (response?.Status == 200) {
              let data = response.Data;
              const estado_plan_id = data.estado_plan_id;
              this.planDocenteService
                .get(`estado_plan/${estado_plan_id}`)
                .subscribe(
                  (response: any) => {
                    if (response?.Status == 200) {
                      resolve(response.Data);
                    } else {
                      resolve(null);
                    }
                  },
                  (error) => {
                    reject(false);
                  }
                );
            } else {
              resolve(null);
            }
          },
          (error) => {
            reject(false);
          }
        );
    });
  }

  async setPuedeEditarPTD(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      try {
        const estado = await this.getEstadoPDT();
        const codigoAbreviacion = estado?.codigo_abreviacion;
        const esNoAprobado = codigoAbreviacion === "N_APR";

        if (esNoAprobado) {
          // Si no fue aprobado, solo el docente puede editar y coordinación solo visualiza
          this.puedeEditarPTD = this.isDocente;
          resolve();
          return;
        }

        if (this.isCoordinador) {
          this.puedeEditarPTD = true;
          resolve();
          return;
        }

        if (this.isDocente) {
          this.puedeEditarPTD = codigoAbreviacion === "ENV_COO";
          resolve();
          return;
        }

        this.puedeEditarPTD = false;
      } catch (error) {
        this.puedeEditarPTD = this.isCoordinador;
      }
      resolve();
    });
  }

  bloquearElementosTabla(): void {
    if (!this.puedeEditarPTD || this.esModoVistaLecturaEstricta) {
      this.listaCargaLectiva.forEach((element) => {
        element.bloqueado = true;
      });
    }
  }

  abrirDialogoVerDetalleEspacio(infoEspacio: any) {
    const infoDialogo = { ...infoEspacio };
    const idEspacio = infoDialogo?.idEspacioAcademico;

    const abrirDialogo = (nombre: string) => {
      infoDialogo.nombre = nombre;
      const dialogRef = this.dialog.open(DialogoVerDetalleColocacionComponent, {
        data: infoDialogo,
        width: "50%",
        height: "auto",
      });

      dialogRef.afterClosed().subscribe((res) => {
        if (res?.asignado) {
          this.asignarDocenteColocacion(res.idColocacionEspacioAcademico);
        }
      });
    };

    this.resolverNombreEspacioAcademico(idEspacio, infoDialogo?.nombre)
      .then((nombreResuelto) => abrirDialogo(nombreResuelto))
      .catch(() =>
        abrirDialogo(
          this.obtenerNombreEspacioAcademicoPorId(idEspacio, infoDialogo?.nombre)
        )
      );
  }

  asignarDocenteColocacion(colocacionId: any) {
    const colocacionParaAsigacionDocente =
      this.listaColocacionesModuloHorario.findIndex(
        (colocacion: any) =>
          colocacion.idColocacionEspacioAcademico == colocacionId
      );

    if (colocacionParaAsigacionDocente !== -1) {
      const colocacion =
        this.listaColocacionesModuloHorario[colocacionParaAsigacionDocente];

      colocacion.tipo = 1; //carga lectiva
      colocacion.bloqueado = false;

      this.listaColocacionesModuloHorario.splice(
        colocacionParaAsigacionDocente,
        1
      );
      this.listaCargaLectiva.push(colocacion);
    }
  }

  verificarSiEspacioTieneColocacionEnModuloHorario(espacio: any) {
    this.listaColocacionesModuloHorario = [];

    const periodoAcademico = (this.Data?.periodo_academico || "").trim();
    const [anio, periodo] = periodoAcademico.split("-");
    const grupoId = espacio?.value?.grupo;
    const codigo = espacio?.value?.codigo;

    if (!anio || !periodo || !codigo || !grupoId) {
      return;
    }

    this.planDocenteMid
      .get(
        `espacio-academico/informacion-horarios/${anio}/${periodo}/${codigo}/${grupoId}`
      )
      .subscribe((res: any) => {
        if (res?.Success && Array.isArray(res.Data)) {
          const colocacionesDeModuloHorario = res.Data.filter(
            (item: any) => !this.existeColocacionEnCargaActual(item)
          );

          if (colocacionesDeModuloHorario.length > 0) {
            this.manejarSiEspacioTieneColocacionEnModuloHorario(
              colocacionesDeModuloHorario
            );
          }
        }
      });
  }

  manejarSiEspacioTieneColocacionEnModuloHorario(colocaciones: any) {
    let existeColocacionModuloHorario = false;

    colocaciones.forEach((colocacion: any) => {
      if (!colocacion.Docente) {
        const colocacionModuloHorario =
          this.construirObjetoCargaDeModuloHorario(colocacion);
        this.listaColocacionesModuloHorario.push(colocacionModuloHorario);
        this.resolverNombreEspacioEnElemento(colocacionModuloHorario);
        existeColocacionModuloHorario = true;
      }
    });

    if (existeColocacionModuloHorario) {
      this.popUpManager.showAlert(
        this.translate.instant(
          "ptd.mensaje_si_espacio_tiene_colocacion_en_modulo_horario_1"
        ),
        this.translate.instant(
          "ptd.mensaje_si_espacio_tiene_colocacion_en_modulo_horario_2"
        )
      );
    }
  }

  construirObjetoCargaDeModuloHorario(colocacion: any) {
    this.identificador++;
    const horarioColocacion =
      colocacion.ResumenColocacionEspacioFisico.colocacion;
    const espacioFisico =
      colocacion.ResumenColocacionEspacioFisico.espacio_fisico;

    const sede =
      espacioFisico.sede || {
        Id: espacioFisico.sede_id,
        CodigoAbreviacion: espacioFisico.sede_id,
        Nombre: espacioFisico.sede_id,
      };
    const edificio =
      espacioFisico.edificio || {
        Id: espacioFisico.edificio_id,
        Nombre: espacioFisico.edificio_id,
      };
    const salon =
      espacioFisico.salon || {
        Id: espacioFisico.salon_id,
        Nombre: espacioFisico.salon_id,
      };

    const colocacionModuloHorario: CardDetalleCarga = {
      id: this.identificador,
      idColocacionEspacioAcademico: colocacion._id,
      nombre: this.obtenerNombreEspacioAcademicoPorId(
        colocacion?.EspacioAcademico?._id,
        colocacion?.EspacioAcademico?.nombre
      ),
      idEspacioAcademico: colocacion.EspacioAcademico._id,
      sede: sede,
      edificio: edificio,
      salon: salon,
      horas: horarioColocacion.horas,
      horaFormato: horarioColocacion.horaFormato,
      estado: horarioColocacion.estado,
      dragPosition: horarioColocacion.dragPosition,
      prevPosition: horarioColocacion.prevPosition,
      finalPosition: horarioColocacion.finalPosition,
      idCarga: "colocacionModuloHorario",
      idActividad: "NA",
      bloqueado: true,
      tipo: 3,
    };

    return colocacionModuloHorario;
  }

  private existeColocacionEnCargaActual(colocacion: any): boolean {
    const horarioColocacion =
      colocacion?.ResumenColocacionEspacioFisico?.colocacion ||
      colocacion?.ColocacionEspacioAcademico;
    const espacioAcademicoId = String(colocacion?.EspacioAcademico?._id || "").trim();

    if (
      espacioAcademicoId &&
      this.listaCargaLectiva.some(
        (item: any) => String(item.idEspacioAcademico || "").trim() === espacioAcademicoId
      )
    ) {
      return true;
    }

    return this.listaCargaLectiva.some((item: any) => {
      if (
        item.idColocacionEspacioAcademico &&
        colocacion._id &&
        item.idColocacionEspacioAcademico === colocacion._id
      ) {
        return true;
      }

      return (
        item.idEspacioAcademico == colocacion?.EspacioAcademico?._id &&
        Number(item.horas) === Number(horarioColocacion?.horas) &&
        Number(item.finalPosition?.x) ===
        Number(horarioColocacion?.finalPosition?.x) &&
        Number(item.finalPosition?.y) ===
        Number(horarioColocacion?.finalPosition?.y)
      );
    });
  }

  private normalizarListaEspacios(fuente: any): any[] {
    if (!fuente) {
      return [];
    }
    if (Array.isArray(fuente)) {
      return [...fuente];
    }
    return Object.keys(fuente).reduce((acumulado: any[], key: string) => {
      const elementos = fuente[key];
      if (Array.isArray(elementos)) {
        acumulado.push(...elementos);
      }
      return acumulado;
    }, []);
  }

  private obtenerNombreEspacioAcademicoPorId(
    espacioId: any,
    fallback?: any
  ): string {
    const id = String(espacioId || "");
    if (!id) {
      return String(fallback || "N/A");
    }

    const espaciosFuente = this.Data?.espacios_academicos || [];
    const espaciosSeleccionados = Array.isArray(espaciosFuente?.[this.seleccion])
      ? espaciosFuente[this.seleccion]
      : [];
    const espaciosGlobales = this.normalizarListaEspacios(espaciosFuente);

    const buscarPorId = (espacios: any[]) =>
      espacios.find(
        (espacio: any) =>
          String(espacio?.id) === id ||
          String(espacio?._id) === id ||
          String(espacio?.codigo) === id ||
          String(espacio?.CodigoEspacioAcademico) === id
      );

    const espacioEncontrado =
      buscarPorId(espaciosSeleccionados) || buscarPorId(espaciosGlobales);

    return String(
      espacioEncontrado?.espacio_academico ||
      espacioEncontrado?.nombre ||
      espacioEncontrado?.Nombre ||
      espacioEncontrado?.EspacioAcademico ||
      fallback ||
      id
    );
  }

  private esNombreSoloId(nombre: any, espacioId: any): boolean {
    const nombreStr = String(nombre || "").trim();
    const idStr = String(espacioId || "").trim();
    if (!nombreStr) {
      return true;
    }
    return nombreStr === idStr || /^[0-9]+$/.test(nombreStr);
  }

  private extraerNombreEspacioDesdeRespuesta(resp: any, fallback: string): string {
    return String(
      resp?.Data?.nombre ||
      resp?.Data?.Nombre ||
      resp?.Data?.EspacioAcademico ||
      resp?.Data?.espacio_academico ||
      resp?.Data?.[0]?.nombre ||
      resp?.Data?.[0]?.Nombre ||
      resp?.Data?.[0]?.EspacioAcademico ||
      resp?.nombre ||
      resp?.Nombre ||
      resp?.EspacioAcademico ||
      fallback
    );
  }

  private async resolverNombreEspacioAcademico(espacioId: any, fallback?: any): Promise<string> {
    const id = String(espacioId || "").trim();
    const nombreLocal = this.obtenerNombreEspacioAcademicoPorId(id, fallback);

    if (!this.esNombreSoloId(nombreLocal, id) || !id) {
      return nombreLocal;
    }

    try {
      const respById: any = await firstValueFrom(
        this.espacioAcademicoService.get(`espacio-academico/${id}`)
      );
      const nombreById = this.extraerNombreEspacioDesdeRespuesta(respById, nombreLocal);
      if (!this.esNombreSoloId(nombreById, id)) {
        return nombreById;
      }
    } catch (e) {
      // continua con fallbacks
    }

    try {
      const respByQuery: any = await firstValueFrom(
        this.espacioAcademicoService.get(
          `espacio-academico?query=_id:${id}&fields=_id,nombre&limit=1`
        )
      );
      const nombreByQuery = this.extraerNombreEspacioDesdeRespuesta(respByQuery, nombreLocal);
      if (!this.esNombreSoloId(nombreByQuery, id)) {
        return nombreByQuery;
      }
    } catch (e) {
      // continua con fallbacks
    }

    try {
      const respCurso: any = await firstValueFrom(
        this.planDocenteMid.get(`espacio-academico/informacion-curso?id=${id}`)
      );
      const nombreCurso = this.extraerNombreEspacioDesdeRespuesta(respCurso, nombreLocal);
      if (!this.esNombreSoloId(nombreCurso, id)) {
        return nombreCurso;
      }
    } catch (e) {
      // ignora error y retorna local
    }

    return nombreLocal;
  }

  private resolverNombreEspacioEnElemento(element: any, cargaOrigen?: any): void {
    if (!element || !element.idEspacioAcademico || element.idEspacioAcademico === "NA") {
      return;
    }

    this.resolverNombreEspacioAcademico(element.idEspacioAcademico, element.nombre)
      .then((nombreResuelto) => {
        if (!this.esNombreSoloId(nombreResuelto, element.idEspacioAcademico)) {
          element.nombre = nombreResuelto;
          if (cargaOrigen) {
            cargaOrigen.espacio_academico_nombre = nombreResuelto;
          }
        }
      })
      .catch(() => {
        // no bloquea el flujo del cargue de fichas
      });
  }

  private obtenerEdificiosDesdeProyecto(): any[] {
    if (!this.EspaciosProyecto?.Edificios) {
      return [];
    }
    if (Array.isArray(this.EspaciosProyecto.Edificios)) {
      return [...this.EspaciosProyecto.Edificios];
    }
    const sedeSeleccionada = this.ubicacionForm.get("sede")?.value;
    const sedeId = sedeSeleccionada?.Id ?? sedeSeleccionada;
    if (!sedeId) {
      return [];
    }
    return [...(this.EspaciosProyecto.Edificios[sedeId] || [])];
  }

  private obtenerSalonesDesdeProyecto(): any[] {
    if (!this.EspaciosProyecto?.Salones) {
      return [];
    }
    if (Array.isArray(this.EspaciosProyecto.Salones)) {
      return [...this.EspaciosProyecto.Salones];
    }
    const edificioSeleccionado = this.ubicacionForm.get("edificio")?.value;
    const edificioId = edificioSeleccionado?.Id ?? edificioSeleccionado;
    if (!edificioId) {
      return [];
    }
    return [...(this.EspaciosProyecto.Salones[edificioId] || [])];
  }

  // Obtiene el Id del tipo de documento para los soportes del PTD usando su código de abreviación.
  private cargarTipoDocumentoSoporte(): Promise<number | null> {
    if (this.tipoDocumentoPtdId) {
      return Promise.resolve(this.tipoDocumentoPtdId);
    }

    return new Promise((resolve) => {
      const endpoint =
        `tipo_documento?query=CodigoAbreviacion:${this.codigoAbreviacionTipoDocPtd},Activo:true&fields=Id&limit=1`;

      this.documentoService.get(endpoint).subscribe(
        (resp: any) => {
          const data = Array.isArray(resp?.Data) ? resp.Data : Array.isArray(resp) ? resp : [];
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
}
