import { IsString, IsOptional } from 'class-validator';

export class PersonalChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  session_id?: string;
}
