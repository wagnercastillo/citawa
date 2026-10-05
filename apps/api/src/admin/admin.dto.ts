import { IsDateString, IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../common/normalize-email';

export class CreateClinicDto {
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsString() @Length(2, 120) ownerName: string;
  @NormalizeEmail() @IsEmail({}, { message: 'Email del dueño inválido' }) ownerEmail: string;
}

export class UpdateClinicDto {
  @IsDateString({ strict: true }, { message: 'paidUntil debe ser una fecha AAAA-MM-DD' }) paidUntil: string;
}
