import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { PopUpManager } from 'src/app/managers/popUpManager';
import { ACTIONS, MODALS, ROLES, VIEWS } from 'src/app/models/diccionario';
import { GestorDocumentalService } from 'src/app/services/gestor-documental.service';
import { SgaPlanTrabajoDocenteMidService } from 'src/app/services/sga-plan-trabajo-docente-mid.service';
import { UserService } from 'src/app/services/user.service';
import { intersection as _intersection, head as _head, cloneDeep as _cloneDeep } from 'lodash-es';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { DialogPreviewFileComponent } from 'src/app/dialog-components/dialog-preview-file/dialog-preview-file.component';

@Component({
    selector: 'asignar-ptd-multiple',
    templateUrl: './asignar-ptd-multiple.component.html',
    styleUrls: ['./asignar-ptd-multiple.component.scss'],
    standalone: false
})
export class AsignarPtdMultipleComponent implements OnInit {

  readonly VIEWS = VIEWS;
  readonly MODALS = MODALS;
  readonly ACTIONS = ACTIONS;
  vista: Symbol;

  rolesCoord: string[] = [ROLES.COORDINADOR, ROLES.ADMIN_DOCENCIA];
  rolesDocente: string[] = [ROLES.DOCENTE];
  coordinador: boolean = false;
  rolIs: string = '';
  rolesIs: string[] = [];
  canEdit: Symbol = ACTIONS.VIEW;
  showCopyPTD: boolean = false;
  @Input()
  selectedView: string = ROLES.DOCENTE;

  asignaturaAdd: any = undefined;

  formDocente: FormGroup;

  detallesAsignaciones: any[] = [];

  periodoCopia: any;
  readonly tipo = { carga_lectiva: 1, actividades: 2 };

  detalleAsignacionRespaldo: any = undefined;
  detalleAsignacionDescartar: any[] = [];

  verReportes: boolean = false;

  @Input() dataDocente: any;
  @Input() detalleAsignacion: any = undefined;
  @Input() periodosAnteriores: any[] = [];
  @Input() soloLectura: boolean = false;
  @Output() OutDetalleChanged: EventEmitter<any> = new EventEmitter();

  constructor(
    private translate: TranslateService,
    private popUpManager: PopUpManager,
    private sgaPlanTrabajoDocenteMidService: SgaPlanTrabajoDocenteMidService,
    private userService: UserService,
    private gestorDocumentalService: GestorDocumentalService,
    private builder: FormBuilder,
    private matDialog: MatDialog,
  ) {
    this.vista = VIEWS.LIST;
    this.formDocente = this.builder.group({});
  }

  ngOnInit() {
    this.userService.getUserRoles().then(roles => {
      const intersection = _intersection(roles, this.rolesDocente.concat(this.rolesCoord));
      if (intersection.length > 0) {
        this.coordinador = true;
        this.rolesIs = intersection;
        this.rolIs = this.selectedView;
        if(!this.soloLectura){
          this.canEdit = ACTIONS.EDIT;
        }
      }
    });
    
    this.buildFormDocente();
  }

  buildFormDocente() {
    this.formDocente = this.builder.group({
      Nombre: [this.dataDocente.Nombre],
      Documento: [this.dataDocente.Documento],
      Periodo: [this.dataDocente.Periodo],
    });
  }
  copy_ptd() {
    const NombrePeriodo = this.periodoCopia.Nombre;
    if (this.rolIs == ROLES.DOCENTE) {
      this.popUpManager.showPopUpGeneric('', this.translate.instant('ptd.copiar_plan_ver_coordinador_p1') + NombrePeriodo + '.<br>' +
        this.translate.instant('ptd.copiar_plan_ver_docente_p1') + '<br><br>' +
        this.translate.instant('ptd.copiar_plan_ver_docente_p2') + '.<br>' +
        this.translate.instant('ptd.copiar_plan_ver_docente_p3') + '.<br>' +
        this.translate.instant('ptd.copiar_plan_ver_docente_p4') + '.', MODALS.QUESTION, true)
        .then(action => {
          if (action.value) {
            this.detalleAsignacionRespaldo = _cloneDeep(this.detalleAsignacion);
            const justCargaLectiva = this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].filter((item: any) => !(item.actividad_id));
            this.detalleAsignacionDescartar = this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].filter((item: any) => (item.actividad_id));
            this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion] = justCargaLectiva;
            this.detalleAsignacion = undefined;
            this.sgaPlanTrabajoDocenteMidService.get(`plan/copiar?docente=${this.dataDocente.docente_id}&vigenciaAnterior=${this.periodoCopia.Id}&vigencia=${this.dataDocente.periodo_id}`+
              `&vinculacion=${this.dataDocente.tipo_vinculacion_id}&carga=${this.tipo.actividades}`).subscribe(resp => {
              this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].push(...resp.Data.carga)
              this.detalleAsignacion = _cloneDeep(this.detalleAsignacionRespaldo);
              this.detalleAsignacion.descartar = this.detalleAsignacionDescartar;
              this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.copy_ptd'), this.translate.instant('ptd.revisar_solapamiento_carga'), MODALS.WARNING, false)
            }, err => {
              this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].push(...this.detalleAsignacionDescartar)
              this.detalleAsignacion = _cloneDeep(this.detalleAsignacionRespaldo);
              this.detalleAsignacion.descartar = [];
              this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.copy_ptd'), this.translate.instant('ptd.no_info_copia_actividades'), MODALS.ERROR, false)
              console.warn(err)
            })
          }
        });
    }
    if (this.rolIs == ROLES.ADMIN_DOCENCIA || this.rolIs == ROLES.COORDINADOR) {
      this.popUpManager.showPopUpGeneric('', this.translate.instant('ptd.copiar_plan_ver_coordinador_p1') + NombrePeriodo + '.<br>' +
        this.translate.instant('ptd.copiar_plan_ver_coordinador_p2') + '.', MODALS.QUESTION, true)
        .then(action => {
          if (action.value) {
            this.detalleAsignacionRespaldo = _cloneDeep(this.detalleAsignacion);
            const justActividades = this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].filter((item: any) => !(item.espacio_academico_id));
            this.detalleAsignacionDescartar = this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].filter((item: any) => (item.espacio_academico_id));
            this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion] = justActividades;
            this.detalleAsignacion = undefined;
            this.sgaPlanTrabajoDocenteMidService.get(`plan/copiar?docente=${this.dataDocente.docente_id}&vigenciaAnterior=${this.periodoCopia.Id}&vigencia=${this.dataDocente.periodo_id}`+
              `&vinculacion=${this.dataDocente.tipo_vinculacion_id}&carga=${this.tipo.carga_lectiva}`).subscribe(resp => {
              this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].push(...resp.Data.carga)
              this.detalleAsignacion = _cloneDeep(this.detalleAsignacionRespaldo);
              this.detalleAsignacion.descartar = this.detalleAsignacionDescartar;
              let textPopUp = []
              let no_requeridos = <any[]>resp.Data.espacios_academicos.no_requeridos;
              if (no_requeridos.length > 0) {
                let nombreEspacios = "";
                no_requeridos.forEach(espacioAcad => {
                  nombreEspacios += "<b>" + espacioAcad.nombre + "</b><br>";
                })
                textPopUp.push(this.translate.instant('ptd.espacios_no_requeridos') + "<br>" + nombreEspacios);
              }
              let sin_carga = <any[]>resp.Data.espacios_academicos.sin_carga;
              if (sin_carga.length > 0) {
                let nombreEspacios = "";
                sin_carga.forEach(preasignEsp => {
                  nombreEspacios += "<b>" + preasignEsp.nombre + "</b><br>";
                })
                textPopUp.push(this.translate.instant('ptd.espacios_sin_asignar') + "<br>" + nombreEspacios);
              }
              //this.popUpManager.showManyPopUp(this.translate.instant('ptd.copy_ptd'), textPopUp, MODALS.INFO)
            }, err => {
              this.detalleAsignacionRespaldo.carga[this.detalleAsignacionRespaldo.seleccion].push(...this.detalleAsignacionDescartar)
              this.detalleAsignacion = _cloneDeep(this.detalleAsignacionRespaldo);
              this.detalleAsignacion.descartar = [];
              this.popUpManager.showPopUpGeneric(this.translate.instant('ptd.copy_ptd'), this.translate.instant('ptd.no_info_copia_carga_lectiva'), MODALS.ERROR, false)
              console.warn(err)
            })
          }
        });
    }
  }

  generarReporte(tipoCarga: string) {
    this.sgaPlanTrabajoDocenteMidService.get(`reporte/plan-trabajo-docente?docente=${this.dataDocente.docente_id}&vinculacion=${this.dataDocente.tipo_vinculacion_id}`+
      `&periodo=${this.dataDocente.periodo_id}&carga=${tipoCarga}`).subscribe(
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
    this.gestorDocumentalService.get([{ Id: idDoc }]).subscribe((resp: any[]) => {
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

  doReload(event: any) {
    //this.loadingNO=event;
  }

  whatChanged(event: any) {
    this.OutDetalleChanged.emit({"carga": event, "docente": this.dataDocente.docente_id})
  }

  onClickCopyPTD() {
    this.showCopyPTD = !this.showCopyPTD;
  }
}
