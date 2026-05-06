import { IsString, IsInt, IsArray, Min, Max, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateScheduleDto {
  @ApiProperty({ example: 'Horario General' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  check_in_time: string;

  @ApiProperty({ example: '18:00' })
  @IsString()
  check_out_time: string;

  @ApiProperty({ example: 15 })
  @IsInt()
  @Min(0)
  @Max(60)
  tolerance_minutes: number;

  @ApiProperty({ example: ['MON', 'TUE', 'WED', 'THU', 'FRI'] })
  @IsArray()
  work_days: string[];
}
