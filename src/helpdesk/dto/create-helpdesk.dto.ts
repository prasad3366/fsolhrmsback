import { IsNotEmpty, IsString } from 'class-validator';

export class CreateHelpdeskDto {
  @IsString()
  @IsNotEmpty()
  issue!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
