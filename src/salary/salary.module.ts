import { Module } from "@nestjs/common";
import { SalaryController } from "./salary.controller";
import { SalaryService } from "./salary.service";
import { PrismaService } from "../prisma/prisma.service";

@Module({

controllers:[SalaryController],

providers:[SalaryService,PrismaService]

})

export class SalaryModule{}