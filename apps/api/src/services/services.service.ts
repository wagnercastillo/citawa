import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './service.entity';
import { CreateServiceDto, UpdateServiceDto } from './services.dto';

export interface ServiceDto {
  id: string;
  name: string;
  durationMin: number;
  active: boolean;
}

const toDto = (s: Service): ServiceDto => ({ id: s.id, name: s.name, durationMin: s.durationMin, active: s.active });

@Injectable()
export class ServicesService {
  constructor(@InjectRepository(Service) private readonly services: Repository<Service>) {}

  async list(clinicId: string): Promise<ServiceDto[]> {
    return (await this.services.find({ where: { clinicId }, order: { name: 'ASC' } })).map(toDto);
  }

  async create(clinicId: string, dto: CreateServiceDto): Promise<ServiceDto> {
    return toDto(await this.services.save(this.services.create({ clinicId, ...dto })));
  }

  async update(clinicId: string, id: string, dto: UpdateServiceDto): Promise<ServiceDto> {
    const service = await this.findInClinic(clinicId, id);
    Object.assign(service, dto);
    return toDto(await this.services.save(service));
  }

  async findInClinic(clinicId: string, id: string): Promise<Service> {
    const service = await this.services.findOne({ where: { id, clinicId } });
    if (!service) throw new NotFoundException('Servicio no encontrado');
    return service;
  }
}
