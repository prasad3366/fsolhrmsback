import { IsNumber, IsString } from 'class-validator';

export class OfficeLocationDto {
  @IsString()
  name: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsNumber()
  radius: number;
}
