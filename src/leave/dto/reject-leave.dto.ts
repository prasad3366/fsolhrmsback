import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class RejectLeaveDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  remarks!: string;
}