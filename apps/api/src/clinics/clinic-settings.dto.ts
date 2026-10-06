import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { TIME_RE } from '../common/zoned-time';

export class UpdateClinicSettingsDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MaxLength(500) paymentInstructions?: string;
  @IsOptional() @IsBoolean() send2hToConfirmed?: boolean;
}

export class HourDto {
  @IsInt() @Min(0) @Max(6) weekday: number;
  @Matches(TIME_RE, { message: 'opensAt debe tener formato HH:MM' }) opensAt: string;
  @Matches(TIME_RE, { message: 'closesAt debe tener formato HH:MM' }) closesAt: string;
}

export class PutHoursDto {
  @IsArray() @ArrayMaxSize(21) @ValidateNested({ each: true }) @Type(() => HourDto) hours: HourDto[];
}
