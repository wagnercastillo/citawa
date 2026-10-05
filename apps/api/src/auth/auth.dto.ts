import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { NormalizeEmail } from '../common/normalize-email';

export class LoginDto {
  @NormalizeEmail() @IsEmail({}, { message: 'Email inválido' }) email: string;
  @IsString() @MinLength(1, { message: 'Ingresa tu contraseña' }) password: string;
}

export class AcceptInviteDto {
  @IsString() token: string;
  @IsString() @Length(8, 72, { message: 'La contraseña debe tener entre 8 y 72 caracteres' }) password: string;
}
