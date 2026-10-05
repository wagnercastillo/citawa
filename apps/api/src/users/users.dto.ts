import { IsBoolean, IsEmail, IsString, Length } from 'class-validator';
import { NormalizeEmail } from '../common/normalize-email';

export class InviteUserDto {
  @IsString() @Length(2, 120) name: string;
  @NormalizeEmail() @IsEmail({}, { message: 'Email inválido' }) email: string;
}

export class SetActiveDto {
  @IsBoolean() active: boolean;
}
