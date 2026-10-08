import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Response } from 'express';
import * as puppeteer from 'puppeteer';
import { getPayrollPeriodRange } from './payroll-period.util';
import {
  PAYSLIP_COMPANY_NAME,
  PAYSLIP_LOGO_DATA_URI,
  PAYSLIP_LOGO_HEIGHT,
  PAYSLIP_LOGO_WIDTH,
} from './payslip-branding';

const TOTALS_TOLERANCE = 0.01;

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
    if (payroll.needsRecalculation) {
      throw new ConflictException('Payroll needs recalculation before a payslip can be issued');
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

    /* Never issue a payslip whose stored totals do not add up */
    // Small epsilon so a genuine 0.01 difference is not rejected by floating-point error
    const isWithinTolerance = (left: number, right: number) => Math.abs(Number(left) - Number(right)) <= TOTALS_TOLERANCE + 1e-9;
    const earningsTotal = payroll.basic + payroll.hra + conveyance + payroll.specialAllowance + payroll.otherAllowance;
    const deductionsTotal = payroll.pf + payroll.pt + payroll.leaveDeduction + otherDeduction;
    if (
      !isWithinTolerance(earningsTotal, payroll.grossSalary) ||
      !isWithinTolerance(deductionsTotal, payroll.deductions) ||
      !isWithinTolerance(payroll.grossSalary - payroll.deductions, payroll.netSalary)
    ) {
      throw new ConflictException('Payroll totals are inconsistent. Recalculate the payroll before issuing a payslip.');
    }

    /* Adjustments are listed individually; any stored amount they do not
       explain (legacy rows) stays as a single "Other" line */
    const adjustmentRows = (type: 'ALLOWANCE' | 'DEDUCTION', storedTotal: number, otherLabel: string) => {
      const adjustments = (payroll.others ?? []).filter((adjustment) => adjustment.type === type);
      const rows = adjustments.map((adjustment) => ({ label: adjustment.name, amount: Number(adjustment.amount) }));
      const remainder = Number(storedTotal) - rows.reduce((sum, row) => sum + row.amount, 0);
      if (!rows.length || Math.abs(remainder) > TOTALS_TOLERANCE) {
        rows.push({ label: otherLabel, amount: rows.length ? remainder : Number(storedTotal) });
      }
      return rows;
    };
    const earningRows = [
      { label: 'Basic', amount: payroll.basic },
      { label: 'HRA', amount: payroll.hra },
      { label: 'Conveyance', amount: conveyance },
      { label: 'Special allowance', amount: payroll.specialAllowance },
      ...adjustmentRows('ALLOWANCE', payroll.otherAllowance, 'Other allowance'),
    ];
    const deductionRows = [
      { label: 'Provident fund', amount: payroll.pf },
      { label: 'Professional tax', amount: payroll.pt },
      { label: 'Leave / LOP deduction', amount: payroll.leaveDeduction },
      ...adjustmentRows('DEDUCTION', otherDeduction, 'Other deductions'),
    ];
    const breakdownRows = Array.from(
      { length: Math.max(earningRows.length, deductionRows.length) },
      (_, index) => {
        const earning = earningRows[index];
        const deduction = deductionRows[index];
        return `<tr><td>${earning ? escapeHtml(earning.label) : ''}</td><td class="amount">${earning ? formatMoney(earning.amount) : ''}</td>`
          + `<td>${deduction ? escapeHtml(deduction.label) : ''}</td><td class="amount">${deduction ? formatMoney(deduction.amount) : ''}</td></tr>`;
      },
    ).join('');

    const { startDate: periodStart, endDateExclusive: periodEndExclusive } = getPayrollPeriodRange(payroll.month, payroll.year);
    const formatPeriodDate = (value: Date) => new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(value);
    const periodDates = `${formatPeriodDate(periodStart)} - ${formatPeriodDate(new Date(periodEndExclusive.getTime() - 24 * 60 * 60 * 1000))}`;
    const revision = Number(payroll.revision ?? 0);
    const revisionLine = revision > 0 ? `<p class="revision">Revised payslip (revision ${revision})</p>` : '';
    const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
    // <EmployeeName>_Payslip_<Month>_<Year>.pdf; falls back to the employee code
    // when the name has no filename-safe characters
    const fileName = `${sanitizeFilePart(employeeName, sanitizeFilePart(employee.empCode, 'Employee'))}_Payslip_${sanitizeFilePart(monthName, 'Month')}_${payroll.year}.pdf`;
    // Official company branding; the logo image already contains the wordmark
    const companyName = PAYSLIP_COMPANY_NAME;
    const companyAddress = settings?.companyAddress || '';
    const logo = `<img class="logo" src="${PAYSLIP_LOGO_DATA_URI}" width="${PAYSLIP_LOGO_WIDTH}" height="${PAYSLIP_LOGO_HEIGHT}" alt="${escapeHtml(companyName)}">`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(`Payslip - ${period} - ${companyName}`)}</title><style>
      @page { size: A4; margin: 16mm 14mm; }
      * { box-sizing: border-box; } body { margin: 0; color: #1f2933; font: 10px/1.4 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; border-bottom:2px solid #163c52; padding-bottom:12px; }
      .brand { min-width:0; } .logo { display:block; width:auto; height:30px; }
      .address { color:#667782; font-size:9px; margin-top:6px; overflow-wrap:anywhere; }
      .document { text-align:right; } .document h1 { margin:0; color:#163c52; font-size:16px; letter-spacing:.5px; } .document p { margin:3px 0 0; color:#667782; } .document .revision { color:#a63e35; font-weight:700; }
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
      <header class="header"><div class="brand">${logo}${companyAddress ? `<div class="address">${escapeHtml(companyAddress)}</div>` : ''}</div>
        <div class="document"><h1>SALARY PAYSLIP</h1><p>Pay period: ${escapeHtml(period)}</p><p>Period dates: ${escapeHtml(periodDates)}</p><p>Payroll ID: ${payroll.id}</p>${revisionLine}</div></header>
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
        ${breakdownRows}
        <tr class="total"><td>Gross salary</td><td class="amount">${formatMoney(payroll.grossSalary)}</td><td>Total deductions</td><td class="amount">${formatMoney(payroll.deductions)}</td></tr>
      </tbody></table></section>
      <div class="net"><span class="net-label">Net salary</span><span class="net-value">${formatMoney(payroll.netSalary)}</span></div>
      <div class="footer">This is a computer-generated payslip and does not require a signature.<br>${escapeHtml(companyName)} · Generated on ${escapeHtml(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(new Date()))}</div>
    </body></html>`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      // Wait for the embedded logo to load before printing
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(pdf);
    } finally {
      await browser.close();
    }
  }
}
