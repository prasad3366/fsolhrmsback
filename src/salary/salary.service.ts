import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SalaryService{

constructor(private prisma:PrismaService){}

async assignSalary(data:{employeeId:number,annualCTC:number,structureId:number}){

const employee = await this.prisma.employee.findUnique({
where:{id:data.employeeId}
});

if(!employee){
throw new BadRequestException("Employee not found");
}

const monthlyCTC = data.annualCTC / 12;

return this.prisma.employeeSalary.create({
data:{
employeeId:data.employeeId,
structureId:data.structureId,
annualCTC:data.annualCTC,
monthlyCTC:monthlyCTC,
effectiveFrom:new Date()
}
});

}

}