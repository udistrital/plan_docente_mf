import { AfterViewInit, Component, OnInit, ViewChild } from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { MODALS, ROLES, VIEWS } from 'src/app/models/diccionario';
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
import { ProyectoAcademicoService } from 'src/app/services/proyecto-academico.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TercerosService } from 'src/app/services/terceros.service';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { DialogoFirmaPtdComponent } from 'src/app/dialog-components/dialogo-firma-ptd/dialogo-firma-ptd.component';
import { DialogPreviewFileComponent } from 'src/app/dialog-components/dialog-preview-file/dialog-preview-file.component';

@Component({
    selector: 'app-verificar-ptd',
    templateUrl: './verificar-ptd.component.html',
    styleUrls: ['./verificar-ptd.component.scss'],
    standalone: false
})
export class VerificarPtdComponent implements OnInit, AfterViewInit {

  readonly VIEWS = VIEWS;
  readonly MODALS = MODALS;
  vista: Symbol;

  rolesCoord: string[] = [ROLES.COORDINADOR, ROLES.ADMIN_DOCENCIA];
  isCoordinator: string|undefined = undefined;
  roles: string[] = [];
  
  dataSource: MatTableDataSource<any>;
  displayedColumns: string[] = ["nombre", "identificacion", "tipo_vinculacion", "periodo_academico", "soporte_documental", "gestion", "estado"];
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
    private proyectoAcademicoService: ProyectoAcademicoService,
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

  ngOnInit() {
    this.cargarEventoPTD();
    this.userService.getUserRoles().then(roles => {
      this.roles = roles;
      this.isCoordinator = _head(_intersection(roles, this.rolesCoord));
    });
    this.loadSelects();
    this.buildForms();
  }

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
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
            }).catch(err => console.warn(err));
          }
        }
      },
      error: (err: any) => {
        console.warn("Error obteniendo calendario/eventos:", err);
      }
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
    this.cargarPlan(event.rowData);
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
      let promesas = [];
      promesas.push(this.loadPeriodo().then(periodos => {
        this.periodos.opciones = periodos;
        this._todosLosPeriodos = [...periodos];
      }));
      promesas.push(this.cargarEstadosPlan().then(estadosPlan => {
        this.estadosPlan.opciones = estadosPlan;
        this.estadosPlan.opcionesfiltradas = this.estadosPlan.opciones.filter(estado => (estado.codigo_abreviacion == "APR") || (estado.codigo_abreviacion == "N_APR"));
      }));
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
    if (this.proyectos.select) {
      this.filtrarPeriodosPorCalendario();
    }
  }

  onPeriodoChange() {
    this.dataSource = new MatTableDataSource();
    if (this.periodos.select) {
      this.verificarRangoFechas();
      if (!this.enRangoCalendario) {
        this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
      }
    }
  }

  filtrarPlanes(): void {
    if (!this.enRangoCalendario) {
      this.popUpManager.showErrorToast("El periodo seleccionado no se encuentra en el rango de fechas.");
      return;
    }
    if (this.periodos.select && (this.proyectos.select || this.roles.includes(ROLES.DOCENTE))) {
      // let url = `plan/preaprobado?vigencia=${this.periodos.select.Id}`;
      // if (this.proyectos.select && !this.roles.includes(ROLES.DOCENTE)) {
      //   url += `&proyecto=${this.proyectos.select.Id}`;
      // }
      // let url = `plan/preaprobado?vigencia=${this.periodos.select.Id}&proyecto=${this.proyectos.select.Id}`;
      
      let url = `asignacion?vigencia=${this.periodos.select.Id}`;
      if (this.proyectos.select && !this.roles.includes(ROLES.DOCENTE)) {
        url += `&proyecto=${this.proyectos.select.Id}`;
      }

      this.sgaPlanTrabajoDocenteMidService.get(`preasignacion?vigencia=${this.periodos.select.Id}`).subscribe(
        (respPre) => {
          // const preasignaciones = Array.isArray(respPre?.Data) ? respPre.Data : []; // Información de la carga
          
          this.sgaPlanTrabajoDocenteMidService.get(url).subscribe(
            (resp) => {
              let planes = (resp.Data || [])
                .filter((row: any) => row.estado === "Enviado a coordinación")
                .map((row: any) => {
                  return {
                    ...row,
                    nombre: row.docente, // La tabla usa 'nombre'
                    tercero_id: row.docente_id, // Para cargarPlan()
                    vinculacion_id: row.tipo_vinculacion_id, // Para cargarPlan()
                    id: row.plan_docente_id // Para traer la informacion de plan_docente en cargarPlan()
                  };
                });
              
              // Opcional: Filtrar o cruzar con preasignaciones si la lógica del negocio lo llega a requerir
              // ...

              this.dataSource = new MatTableDataSource(planes);
            }, (err) => {
              this.dataSource = new MatTableDataSource();
              console.warn(err);
              this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.verificacion_ptd'),this.translate.instant('ptd.no_planes_particulares'), MODALS.WARNING, false)
            }
          );
        },
        (errPre) => {
          console.warn("Error obteniendo preasignacion:", errPre);
          this.dataSource = new MatTableDataSource();
          this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.verificacion_ptd'),this.translate.instant('ptd.no_planes_particulares'), MODALS.WARNING, false)
        }
      );

      /* CÓDIGO COMENTADO QUE YA NO SE USARÁ:
      this.sgaPlanTrabajoDocenteMidService.get(url).subscribe(
        (resp) => {
          let planes = <any[]>resp.Data;
          planes.forEach(plan => {
            plan.periodo_academico = this.periodos.opciones.find(p => p.Id === plan.periodo_academico)?.Nombre;
            plan.estado = this.estadosPlan.opciones.find(e => e._id === plan.estado)?.nombre;
          })
          this.dataSource = new MatTableDataSource(planes);
        }, (err) => {
          this.dataSource = new MatTableDataSource();
          console.warn(err);
          this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.verificacion_ptd'),this.translate.instant('ptd.no_planes_particulares'), MODALS.WARNING, false)
        }
      );
      */
    }
  }

  cargarPlan(plan: any) {
    this.sgaPlanTrabajoDocenteMidService.get(`plan?docente=${plan.tercero_id}&vigencia=${this.periodos.select.Id}&vinculacion=${plan.vinculacion_id}`).subscribe(
      (resp) => {
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

        this.planTrabajoDocenteService.get('plan_docente/'+plan.id).subscribe(resPlan => {
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
              this.getInfoResponsable(terceroId);
            } else {
              this.userService.getPersonaId().then((terceroId) => {
                this.getInfoResponsable(terceroId);
              }).catch(() => {
                this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
              });
            }
          } else {
            this.userService.getPersonaId().then((terceroId) => {
              this.getInfoResponsable(terceroId);
            }).catch(() => {
              this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
            });
          }
        }, err => {
          console.warn(err);
          this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
        });

        this.vista = VIEWS.FORM;
      }, (err) => {
        console.warn(err);
        this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
      }
    );
  }

  getInfoResponsable(terceroId: number) {
    this.tercerosService.get('tercero/' + terceroId).subscribe({
      next: (resTerc) => {
        this.formVerificar.patchValue({
          QuienResponde: resTerc.NombreCompleto,
        })
      },
      error: (err) => {
        console.warn(err);
        this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'), this.translate.instant('ERROR.persiste_error_comunique_OAS'), MODALS.ERROR, false)
      }
    });
  }

  validarFormVerificar() {
    this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.dar_respuesta'), "", MODALS.QUESTION, true).then(
      async action => {
        if (action.value) {
          this.userService.getPersonaId().then(async terceroId => {
            let putPlan = _cloneDeep(this.planDocenteEstadoGet);
            let respuestaJson = putPlan.respuesta ? JSON.parse(putPlan.respuesta) : {};
            respuestaJson["concertado"] = this.formVerificar.get('DeAcuerdo')?.value;
            respuestaJson["observacion"] = this.formVerificar.get('Observaciones')?.value;
            respuestaJson["responsable_id"] = terceroId;
            putPlan.respuesta = JSON.stringify(respuestaJson);
            const estAprov = this.formVerificar.get('EstadoAprobado')?.value;
            putPlan.estado_plan_id = estAprov._id;
            
            if (estAprov.codigo_abreviacion === "APR") {
              const dialogParams = new MatDialogConfig();
              dialogParams.width = '40vw';
              dialogParams.minWidth = '540px';
              dialogParams.height = '40vh';
              dialogParams.maxHeight = '390px';
              dialogParams.data = {
                docenteId: putPlan.docente_id,
                responsableId: respuestaJson.responsable_id,
                vinculacionId: this.dataDocente.tipo_vinculacion_id,
                periodoId: this.periodos.select.Id,
              };
              const dialogFirma = this.matDialog.open(DialogoFirmaPtdComponent, dialogParams);
              const outDialog = await dialogFirma.afterClosed().toPromise();
              if (outDialog.document) {
                putPlan.soporte_documental = outDialog.document;
                this.planTrabajoDocenteService.put('plan_docente/'+putPlan._id, putPlan).subscribe(
                  resp => {
                    this.popUpManager.showSuccessAlert(this.translate.instant('ptd.respuesta_enviada'))
                  }, err => {
                    this.popUpManager.showErrorAlert(this.translate.instant('ptd.error_respuesta_enviada'))
                    console.warn(err);
                  }
                );
              } else if (outDialog.error) {
                this.popUpManager.showPopUpGeneric(this.translate.instant('ERROR.titulo_generico'),
                                          this.translate.instant('ERROR.fallo_informacion_en') + ': <b>' + outDialog.from + '</b>.<br><br>' +
                                          this.translate.instant('ERROR.persiste_error_comunique_OAS'),
                                          MODALS.ERROR, false);
              }
            } else {
              this.planTrabajoDocenteService.put('plan_docente/'+putPlan._id, putPlan).subscribe(
                resp => {
                  this.popUpManager.showSuccessAlert(this.translate.instant('ptd.respuesta_enviada'))
                }, err => {
                  this.popUpManager.showErrorAlert(this.translate.instant('ptd.error_respuesta_enviada'))
                  console.warn(err);
                }
              );
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
    this.filtrarPlanes();
    this.vista = VIEWS.LIST;
  }

}
