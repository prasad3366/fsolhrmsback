import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Response } from 'express';
import * as puppeteer from 'puppeteer';

@Injectable()
export class PayslipService {
  constructor(private prisma: PrismaService) {}

  async generatePayslip(payrollId: number, res: Response) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      include: { employee: true },
    });

    if (!payroll) {
      throw new NotFoundException('Payroll not found');
    }

    const emp = payroll.employee;

    /* HTML TEMPLATE */

    const html = `
<html>
<head>
<style>

body{
font-family: Arial;
padding:30px;
}

.company{
text-align:center;
font-size:22px;
font-weight:bold;
margin-bottom:10px;
}

.subtitle{
text-align:center;
margin-bottom:20px;
}

table{
width:100%;
border-collapse:collapse;
margin-top:15px;
}

td,th{
border:1px solid #000;
padding:6px;
font-size:13px;
}

.no-border td{
border:none;
}

.section{
background:#f2f2f2;
font-weight:bold;
}

</style>
</head>

<body>

<div class="company">
PALATE NETWORKS PRIVATE LIMITED
</div>

<div class="subtitle">
Salary Slip
</div>

<!-- EMPLOYEE DETAILS -->

<table>

<tr>
<td><b>Employee Code</b></td>
<td>${emp?.empCode || ''}</td>

<td><b>Name</b></td>
<td>${emp?.firstName || ''} ${emp?.lastName || ''}</td>
</tr>

<tr>
<td><b>Department</b></td>
<td>${emp?.department || ''}</td>

<td><b>Designation</b></td>
<td>${emp?.designation || ''}</td>
</tr>

<tr>
<td><b>Date Of Joining</b></td>
<td>${emp?.dateOfJoining ? new Date(emp.dateOfJoining).toLocaleDateString() : ''}</td>

<td><b>PF Number</b></td>
<td>${emp?.pfNumber || ''}</td>
</tr>

<tr>
<td><b>UAN Number</b></td>
<td>${emp?.uanNumber || ''}</td>

<td><b>PAN</b></td>
<td>${emp?.panNumber || ''}</td>
</tr>

<tr>
<td><b>Bank Name</b></td>
<td>${emp?.bankName || ''}</td>

<td><b>Account Number</b></td>
<td>${emp?.bankAccountNumber || ''}</td>
</tr>

</table>

<!-- SALARY TABLE -->

<table>

<tr class="section">
<th>Earnings</th>
<th>Amount</th>
<th>Deductions</th>
<th>Amount</th>
</tr>

<tr>
<td>Basic Salary</td>
<td>${payroll.basic}</td>

<td>Professional Tax</td>
<td>${payroll.pt}</td>
</tr>

<tr>
<td>House Rent Allowance</td>
<td>${payroll.hra}</td>

<td>Provident Fund</td>
<td>${payroll.pf}</td>
</tr>

<tr>
<td>Special Allowance</td>
<td>${payroll.specialAllowance || 0}</td>

<td>LOP Deduction</td>
<td>${payroll.leaveDeduction || 0}</td>
</tr>

<tr>
<td>Other Allowance</td>
<td>${payroll.otherAllowance || 0}</td>

<td></td>
<td></td>
</tr>

<tr>
<td><b>Total Earnings</b></td>
<td><b>${payroll.grossSalary}</b></td>

<td><b>Total Deductions</b></td>
<td><b>${payroll.deductions}</b></td>
</tr>

</table>

<!-- NET PAY -->

<table>

<tr>
<td style="width:70%"><b>Net Salary</b></td>
<td><b>₹ ${payroll.netSalary}</b></td>
</tr>

</table>

<br><br>

<table class="no-border">

<tr>
<td>Employer Signature</td>
<td style="text-align:right">Employee Signature</td>
</tr>

</table>

</body>
</html>
`;

    /* GENERATE PDF */

    const browser = await puppeteer.launch();

    const page = await browser.newPage();

    await page.setContent(html);

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=payslip.pdf');

    res.send(pdf);
  }
}
