import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateHelpdeskDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  issue!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  reason!: string;
}
