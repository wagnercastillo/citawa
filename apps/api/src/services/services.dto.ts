import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateServiceDto {
  @IsString() @Length(2, 120) name: string;
  @IsInt() @Min(5) @Max(480) durationMin: number;
}

export class UpdateServiceDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMin?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
