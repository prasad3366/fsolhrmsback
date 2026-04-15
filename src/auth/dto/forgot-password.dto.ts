import { IsEmail, MinLength, IsOptional, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  otp?: string;

  @IsOptional()
  @MinLength(6)
  newPassword?: string;
}
