import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreatePatientDto {
  @IsString() @Length(2, 160) fullName: string;
  @IsString() @MaxLength(30) phone: string;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdatePatientDto {
  @IsOptional() @IsString() @Length(2, 160) fullName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class SearchPatientsDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
