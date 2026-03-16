import { Controller, Post, Body } from "@nestjs/common";
import { SalaryService } from "./salary.service";

@Controller("salary")
export class SalaryController {

constructor(private salaryService: SalaryService){}

@Post("assign")
assignSalary(
@Body() body:{employeeId:number,annualCTC:number,structureId:number}
){
return this.salaryService.assignSalary(body);
}

}