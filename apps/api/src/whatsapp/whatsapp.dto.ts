import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class ConnectWhatsappDto {
  @IsString() @Length(10, 500) apiKey: string;
  @IsString() @MaxLength(30) phoneNumber: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
}
