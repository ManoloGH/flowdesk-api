import { IsEmail, IsString, MinLength, Matches, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterSuperAdminDto {
  @ApiProperty({ example: 'FlowDesk Admin' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'admin@flowdesk.app' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin123!@#' })
  @IsString()
  @MinLength(12)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'La contraseña requiere mayúscula, minúscula, número y símbolo especial',
  })
  password: string;

  @ApiProperty({ example: 'flowdesk-super-secret', required: false })
  @IsOptional()
  @IsString()
  setup_key?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  current_password: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'La contraseña requiere mayúscula, minúscula, número y símbolo especial',
  })
  new_password: string;
}
