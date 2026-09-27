import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Response } from 'express';
import * as puppeteer from 'puppeteer';

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sanitizeFilePart = (value: unknown, fallback: string): string => {
  const sanitized = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return sanitized || fallback;
};

@Injectable()
export class PayslipService {
  constructor(private prisma: PrismaService) {}

  async generatePayslip(payrollId: number, res: Response) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      include: { employee: true, others: true },
    });

    if (!payroll) throw new NotFoundException('Payroll not found');
    if (payroll.status !== 'FINALIZED' && payroll.status !== 'PAID') {
      throw new BadRequestException('Payslip is available only for finalized or paid payroll');
    }

    const settings = await this.prisma.systemSetting.findUnique({ where: { id: 1 } });
    const timeZone = settings?.timeZone || 'Asia/Kolkata';
    const currency = settings?.currency || 'INR';
    const locale = currency === 'INR' ? 'en-IN' : 'en-US';
    const formatMoney = (value: number) => new Intl.NumberFormat(locale, {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(Number(value || 0));
    const formatDate = (value: Date | null | undefined) => value
      ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(new Date(value))
      : '';
    const periodDate = new Date(Date.UTC(payroll.year, payroll.month - 1, 1));
    const period = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone }).format(periodDate);
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone }).format(periodDate);
    const employee = payroll.employee;
    const conveyance = payroll.conveyance ?? payroll.grossSalary - payroll.basic - payroll.hra - payroll.specialAllowance - payroll.otherAllowance;
    const otherDeduction = payroll.otherDeduction ?? Math.max(payroll.deductions - payroll.pf - payroll.pt - payroll.leaveDeduction, 0);
    const paidLeaveDays = payroll.paidLeaveDays ?? 0;
    const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
    const fileName = `${sanitizeFilePart(employee.empCode, 'EMPLOYEE')}_${sanitizeFilePart(monthName, 'Month')}_${payroll.year}_Payslip.pdf`;
    const companyName = settings?.companyName || '';
    const companyAddress = settings?.companyAddress || '';
    const logo = settings?.companyLogo
      ? `<img class="logo" src="${escapeHtml(settings.companyLogo)}" alt="${escapeHtml(companyName)} logo">`
      : '';

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 16mm 14mm; }
      * { box-sizing: border-box; } body { margin: 0; color: #1f2933; font: 10px/1.4 Arial, Helvetica, sans-serif; }
      .header { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #163c52; padding-bottom:12px; }
      .brand { display:flex; align-items:center; gap:10px; min-width:0; } .logo { max-width:54px; max-height:42px; object-fit:contain; }
      .company { color:#163c52; font-size:18px; font-weight:700; overflow-wrap:anywhere; } .address { color:#667782; font-size:9px; overflow-wrap:anywhere; }
      .document { text-align:right; } .document h1 { margin:0; color:#163c52; font-size:16px; letter-spacing:.5px; } .document p { margin:3px 0 0; color:#667782; }
      .section { margin-top:16px; page-break-inside:avoid; } .section-title { border-bottom:1px solid #cbd8dd; color:#163c52; font-size:11px; font-weight:700; letter-spacing:.5px; padding-bottom:5px; text-transform:uppercase; }
      table { width:100%; border-collapse:collapse; table-layout:fixed; } th { background:#edf3f5; color:#163c52; font-weight:700; text-align:left; }
      td, th { border-bottom:1px solid #dce5e8; padding:7px 8px; overflow-wrap:anywhere; vertical-align:top; } .info td:nth-child(odd) { color:#667782; font-weight:700; width:18%; } .info td:nth-child(even) { width:32%; }
      .amount { text-align:right; white-space:nowrap; } .total td { background:#f4f8f9; color:#163c52; font-weight:700; }
      .summary { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin-top:8px; } .metric { border:1px solid #dce5e8; padding:8px; min-width:0; }
      .metric-label { color:#667782; font-size:9px; } .metric-value { color:#163c52; font-size:12px; font-weight:700; overflow-wrap:anywhere; }
      .net { background:#163c52; color:#fff; display:flex; justify-content:space-between; align-items:center; margin-top:18px; padding:13px 16px; page-break-inside:avoid; }
      .net-label { font-size:12px; font-weight:700; text-transform:uppercase; } .net-value { font-size:18px; font-weight:700; }
      .footer { border-top:1px solid #dce5e8; color:#667782; font-size:9px; margin-top:22px; padding-top:8px; text-align:center; }
    </style></head><body>
      <header class="header"><div class="brand">${logo}<div><div class="company">${escapeHtml(companyName)}</div><div class="address">${escapeHtml(companyAddress)}</div></div></div>
        <div class="document"><h1>SALARY PAYSLIP</h1><p>Pay period: ${escapeHtml(period)}</p><p>Payroll ID: ${payroll.id}</p></div></header>
      <section class="section"><div class="section-title">Employee information</div><table class="info"><tbody>
        <tr><td>Employee name</td><td>${escapeHtml(employeeName)}</td><td>Employee code</td><td>${escapeHtml(employee.empCode)}</td></tr>
        <tr><td>Department</td><td>${escapeHtml(employee.department)}</td><td>Designation</td><td>${escapeHtml(employee.designation)}</td></tr>
        <tr><td>Joining date</td><td>${escapeHtml(formatDate(employee.dateOfJoining))}</td><td>Payroll status</td><td>${escapeHtml(payroll.status)}</td></tr>
        <tr><td>Bank name</td><td>${escapeHtml(employee.bankName)}</td><td>Account number</td><td>${escapeHtml(employee.bankAccountNumber)}</td></tr>
        <tr><td>PF / UAN / PAN</td><td colspan="3">${escapeHtml([employee.pfNumber, employee.uanNumber, employee.panNumber].filter(Boolean).join(' / '))}</td></tr>
      </tbody></table></section>
      <section class="section"><div class="section-title">Attendance summary</div><div class="summary">
        <div class="metric"><div class="metric-label">Working days</div><div class="metric-value">${payroll.workingDays}</div></div>
        <div class="metric"><div class="metric-label">Present days</div><div class="metric-value">${payroll.presentDays}</div></div>
        <div class="metric"><div class="metric-label">Paid leave days</div><div class="metric-value">${paidLeaveDays}</div></div>
        <div class="metric"><div class="metric-label">LOP days</div><div class="metric-value">${payroll.lopDays}</div></div>
      </div></section>
      <section class="section"><div class="section-title">Payroll breakdown</div><table><thead><tr><th>Earnings</th><th class="amount">Amount</th><th>Deductions</th><th class="amount">Amount</th></tr></thead><tbody>
        <tr><td>Basic</td><td class="amount">${formatMoney(payroll.basic)}</td><td>Provident fund</td><td class="amount">${formatMoney(payroll.pf)}</td></tr>
        <tr><td>HRA</td><td class="amount">${formatMoney(payroll.hra)}</td><td>Professional tax</td><td class="amount">${formatMoney(payroll.pt)}</td></tr>
        <tr><td>Conveyance</td><td class="amount">${formatMoney(conveyance)}</td><td>Leave / LOP deduction</td><td class="amount">${formatMoney(payroll.leaveDeduction)}</td></tr>
        <tr><td>Special allowance</td><td class="amount">${formatMoney(payroll.specialAllowance)}</td><td>Other deductions</td><td class="amount">${formatMoney(otherDeduction)}</td></tr>
        <tr><td>Other allowance</td><td class="amount">${formatMoney(payroll.otherAllowance)}</td><td></td><td></td></tr>
        <tr class="total"><td>Gross salary</td><td class="amount">${formatMoney(payroll.grossSalary)}</td><td>Total deductions</td><td class="amount">${formatMoney(payroll.deductions)}</td></tr>
      </tbody></table></section>
      <div class="net"><span class="net-label">Net salary</span><span class="net-value">${formatMoney(payroll.netSalary)}</span></div>
      <div class="footer">Generated on ${escapeHtml(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(new Date()))}</div>
    </body></html>`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(pdf);
    } finally {
      await browser.close();
    }
  }
}
