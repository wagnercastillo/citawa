import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { D360Client, D360Credentials } from './d360-client';
import { normalizeTemplateStatus, TEMPLATE_DEFS, templateCreatePayload } from './templates';
import { WaTemplateStatus, WhatsappTemplate } from './whatsapp-template.entity';

export interface TemplateDto {
  name: string;
  status: WaTemplateStatus;
  rejectionReason: string | null;
}

@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly d360: D360Client) {}

  /** Crea en 360dialog las plantillas del spec (si ya existen, sigue) y sincroniza su estado. */
  async provision(clinicId: string, creds: D360Credentials): Promise<void> {
    for (const def of TEMPLATE_DEFS) {
      try {
        await this.d360.createTemplate(creds, templateCreatePayload(def));
      } catch (e) {
        this.logger.warn(`Plantilla ${def.name} (${clinicId}): ${(e as Error).message}`);
      }
      await this.ds.query(
        `INSERT INTO whatsapp_templates (clinic_id, name) VALUES ($1, $2) ON CONFLICT (clinic_id, name) DO NOTHING`,
        [clinicId, def.name],
      );
    }
    await this.refresh(clinicId, creds).catch((e) => this.logger.warn(`No se pudo consultar plantillas: ${(e as Error).message}`));
  }

  async refresh(clinicId: string, creds: D360Credentials): Promise<void> {
    const remote = await this.d360.listTemplates(creds);
    for (const def of TEMPLATE_DEFS) {
      const t = remote.find((r) => r.name === def.name);
      if (!t) continue;
      const status = normalizeTemplateStatus(t.status);
      await this.ds.getRepository(WhatsappTemplate).update(
        { clinicId, name: def.name },
        { status, rejectionReason: status === WaTemplateStatus.REJECTED ? (t.rejected_reason ?? 'Rechazada por Meta') : null },
      );
    }
  }

  async list(clinicId: string): Promise<TemplateDto[]> {
    const rows = await this.ds.getRepository(WhatsappTemplate).find({ where: { clinicId }, order: { name: 'ASC' } });
    return rows.map((t) => ({ name: t.name, status: t.status, rejectionReason: t.rejectionReason }));
  }

  async approvedNames(clinicId: string): Promise<Set<string>> {
    const rows = await this.ds.getRepository(WhatsappTemplate).findBy({ clinicId, status: WaTemplateStatus.APPROVED });
    return new Set(rows.map((t) => t.name));
  }
}
