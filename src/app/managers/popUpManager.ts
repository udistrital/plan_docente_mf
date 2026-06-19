import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';
import { SweetAlertIcon, SweetAlertOptions } from 'sweetalert2';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';


@Injectable({
    providedIn: 'root',
})
export class PopUpManager {
    constructor(
        private snackBar: MatSnackBar,
        private translate: TranslateService,
    ) { }

    public showToast(message: string, duration: number = 3000) {
        this.snackBar.open(message, this.translate.instant('GLOBAL.cerrar'), {
            duration: duration,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['success-snackbar']
        });
    }

    public showErrorToast(message: string, duration: number = 3000) {
        this.snackBar.open(message, this.translate.instant('GLOBAL.cerrar'), {
            duration: duration,
            panelClass: ['error-snackbar'],
        });
    }

    public showInfoToast(message: string, duration: number = 3000) {
        this.snackBar.open(message, this.translate.instant('GLOBAL.cerrar'), {
            duration: duration,
            panelClass: ['info-snackbar'],
        });
    }

    public showAlert(title: string, text: string) {
        Swal.fire({
            icon: 'info',
            title: title,
            text: text,
            confirmButtonText: this.translate.instant('GLOBAL.aceptar'),
        });
    }

    public showSuccessAlert(text: string) {
        return Swal.fire({
            icon: 'success',
            title: this.translate.instant('GLOBAL.operacion_exitosa'),
            text: text,
            confirmButtonText: this.translate.instant('GLOBAL.aceptar'),
        });
    }

    public showErrorAlert(text: string) {
        Swal.fire({
            icon: 'error',
            title: this.translate.instant('GLOBAL.error'),
            text: text,
            confirmButtonText: this.translate.instant('GLOBAL.aceptar'),
        });
    }

    public showConfirmAlert(text: string, title = this.translate.instant('GLOBAL.atencion')): Promise<any> {
        const options: any = {
            title: title,
            text: text,
            type: 'warning',
            showCancelButton: true,
            confirmButtonText: this.translate.instant('GLOBAL.aceptar'),
            cancelButtonText: this.translate.instant('GLOBAL.cancelar'),
        };
        return Swal.fire(options);
    }

    public showPopUpGeneric(title: string, text: string, type: any, cancelar: boolean): Promise<any> {
        const opt: any = {
            title: title,
            html: text,
            icon: type,
            showCancelButton: cancelar,
            allowOutsideClick: !cancelar,
            confirmButtonText: this.translate.instant('GLOBAL.aceptar'),
            cancelButtonText: this.translate.instant('GLOBAL.cancelar'),
        };
        return Swal.fire(opt);
    }

    public showPopUpForm(title: string, form: { html: string[]; ids: any[]; }, cancelar: boolean): Promise<any> {
        const opt: any = {
            title: title,
            html: form.html,
            showCancelButton: cancelar,
            allowOutsideClick: !cancelar,
            confirmButtonText: this.translate.instant('GLOBAL.aceptar'),
            cancelButtonText: this.translate.instant('GLOBAL.cancelar'),
            preConfirm: () => {
                const results: { [key: string]: any } = {};
                form.ids.forEach(id => {
                    const element = <HTMLInputElement>Swal.getPopup()!.querySelector('#' + id);
                    results[id] = element.value;
                });
                return results;
            },
        };
        return Swal.fire(opt);
    }
    public showLoading(message?: string) {

    Swal.fire({
        title: message || this.translate.instant('GLOBAL.cargando'),
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });
}
public closeLoading() {
    Swal.close();
}
    /* public showManyPopUp(title, steps: any[], type) { // Not supported now :(
        const opts = steps.map(step => {
            return {
                title: title,
                html: step,
                icon: type,
                confirmButtonText: this.translate.instant('GLOBAL.aceptar')
            }
        })
        return Swal.queue(opts)
    } */
}
