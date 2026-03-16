import { IsInt, Min } from "class-validator"

export class RunPayrollDto {

  @IsInt()
  @Min(1)
  employeeId: number

  @IsInt()
  @Min(1)
  month: number

  @IsInt()
  year: number

}