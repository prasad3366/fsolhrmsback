import { BadRequestException } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { PayslipService } from './payslip.service';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));

describe('PayslipService', () => {
  const launch = puppeteer.launch as jest.Mock;
  let prisma: any;
  let service: PayslipService;
  let response: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      payroll: { findUnique: jest.fn() },
      systemSetting: { findUnique: jest.fn().mockResolvedValue({
        companyName: 'Configured Company',
        companyAddress: 'Configured Address',
        currency: 'INR',
        timeZone: 'Asia/Kolkata',
      }) },
    };
    response = { setHeader: jest.fn(), send: jest.fn() };
    service = new PayslipService(prisma);
  });

  it.each(['DRAFT', 'INVALID'])('rejects %s payroll as an official payslip', async (status) => {
    prisma.payroll.findUnique.mockResolvedValue({ id: 1, status });

    await expect(service.generatePayslip(1, response)).rejects.toThrow(BadRequestException);
    expect(launch).not.toHaveBeenCalled();
  });

  it.each(['FINALIZED', 'PAID'])('renders %s persisted payroll without recalculating', async (status) => {
    prisma.payroll.findUnique.mockResolvedValue({
      id: 7,
      status,
      month: 9,
      year: 2026,
      workingDays: 22,
      presentDays: 19,
      paidLeaveDays: 2,
      lopDays: 1,
      basic: 35000,
      hra: 17500,
      conveyance: 15000,
      specialAllowance: 32500,
      otherAllowance: 1000,
      pf: 4200,
      pt: 200,
      leaveDeduction: 2500,
      otherDeduction: 300,
      grossSalary: 101000,
      deductions: 7200,
      netSalary: 93800,
      employee: {
        empCode: 'EMP/007',
        firstName: 'Asha <Test>',
        lastName: 'Employee',
        department: 'Research & Development',
        designation: 'Lead Engineer',
        dateOfJoining: new Date('2024-01-15T00:00:00.000Z'),
        bankName: 'Bank',
        bankAccountNumber: '1234',
        pfNumber: 'PF1',
        uanNumber: 'UAN1',
        panNumber: 'PAN1',
      },
      others: [],
    });
    const page = {
      setContent: jest.fn(),
      pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    };
    launch.mockResolvedValue({ newPage: jest.fn().mockResolvedValue(page), close: jest.fn() });

    await service.generatePayslip(7, response);

    const html = page.setContent.mock.calls[0][0] as string;
    expect(html).toContain('93,800.00');
    expect(html).toContain('Conveyance');
    expect(html).toContain('Paid leave days');
    expect(html).toContain('Asha &lt;Test&gt;');
    expect(html).not.toContain('Asha <Test>');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('EMP_007_September_2026_Payslip.pdf'),
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('pdf'));
  });
});
