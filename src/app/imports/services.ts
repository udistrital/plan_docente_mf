import { DocumentoService } from "../services/documento.service";
import { EspaciosAcademicosService } from "../services/espacios-academicos.service";
import { GestorDocumentalService } from "../services/gestor-documental.service";
import { AcademicaJbpmService } from "../services/academica-jbpm.service";
import { ParametrosService } from "../services/parametros.service";
import { PlanTrabajoDocenteService } from "../services/plan-trabajo-docente.service";
import { ProyectoAcademicoService } from "../services/proyecto-academico.service";
import { SgaEspaciosAcademicosMidService } from "../services/sga-espacios-academicos-mid.service";
import { SgaPlanTrabajoDocenteMidService } from "../services/sga-plan-trabajo-docente-mid.service";
import { TercerosService } from "../services/terceros.service";

export const SERVICES_HTTP = [
    ParametrosService,
    PlanTrabajoDocenteService,
    SgaPlanTrabajoDocenteMidService,
    EspaciosAcademicosService,
    TercerosService,
    AcademicaJbpmService,
    SgaEspaciosAcademicosMidService,
    GestorDocumentalService,
    DocumentoService,
    ProyectoAcademicoService
];