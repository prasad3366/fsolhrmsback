import { BadRequestException } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { PayslipService } from './payslip.service';
import { PAYSLIP_LOGO_DATA_URI, PAYSLIP_LOGO_HEIGHT, PAYSLIP_LOGO_WIDTH } from './payslip-branding';

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
      'attachment; filename="Asha_Test_Employee_Payslip_September_2026.pdf"',
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('pdf'));
  });

  describe('stored payroll safety', () => {
    const basePayroll = {
      id: 7, status: 'FINALIZED', month: 9, year: 2026, needsRecalculation: false, revision: 0,
      workingDays: 21, presentDays: 21, paidLeaveDays: 0, lopDays: 0,
      basic: 30000, hra: 12000, conveyance: 6000, specialAllowance: 12000, otherAllowance: 1500,
      pf: 3600, pt: 200, leaveDeduction: 0, otherDeduction: 300,
      grossSalary: 61500, deductions: 4100, netSalary: 57400,
      employee: { empCode: 'EMP7', firstName: 'Asha', lastName: 'Rao' },
      others: [
        { type: 'ALLOWANCE', name: 'Festival bonus', amount: 1000 },
        { type: 'DEDUCTION', name: 'Canteen', amount: 300 },
      ],
    };
    const render = async (payroll: any) => {
      prisma.payroll.findUnique.mockResolvedValue(payroll);
      const page = { setContent: jest.fn(), pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
      launch.mockResolvedValue({ newPage: jest.fn().mockResolvedValue(page), close: jest.fn() });
      await service.generatePayslip(payroll.id, response);
      return page.setContent.mock.calls[0][0] as string;
    };

    it('rejects payroll that needs recalculation', async () => {
      prisma.payroll.findUnique.mockResolvedValue({ ...basePayroll, needsRecalculation: true });

      await expect(service.generatePayslip(7, response)).rejects.toThrow('needs recalculation');
      expect(launch).not.toHaveBeenCalled();
    });

    it.each([
      ['earnings do not equal gross', { grossSalary: 61600, netSalary: 57500 }],
      ['deductions do not equal their components', { deductions: 4200, netSalary: 57300 }],
      ['net does not equal gross minus deductions', { netSalary: 57401 }],
    ])('never prints an inconsistent payslip when %s', async (_name, override) => {
      prisma.payroll.findUnique.mockResolvedValue({ ...basePayroll, ...override });

      await expect(service.generatePayslip(7, response)).rejects.toThrow('Payroll totals are inconsistent');
      expect(launch).not.toHaveBeenCalled();
    });

    it('accepts a rounding difference within 0.01', async () => {
      await expect(render({ ...basePayroll, netSalary: 57400.01 })).resolves.toContain('57,400.01');
    });

    it('lists adjustments individually and keeps unexplained stored amounts as "Other"', async () => {
      const html = await render(basePayroll);

      expect(html).toContain('Festival bonus');
      expect(html).toContain('Canteen');
      expect(html).toMatch(/Other allowance<\/td><td class="amount">₹500\.00/);
      expect(html).not.toContain('Other deductions');
      expect(html).toContain('57,400.00');
    });

    it('shows the revision of a corrected payslip and the exact period dates', async () => {
      const html = await render({ ...basePayroll, revision: 2 });

      expect(html).toContain('Revised payslip (revision 2)');
      expect(html).toMatch(/Period dates: 29 Aug 2026 - 28 Sept? 2026/);
    });

    it('reads only the persisted Payroll row, never salary or structure data', async () => {
      // The prisma mock has no employeeSalary/salaryStructure models at all
      expect(prisma.employeeSalary).toBeUndefined();
      expect(prisma.salaryStructure).toBeUndefined();

      const html = await render({ ...basePayroll, basic: 17500, hra: 7000, conveyance: 2000, specialAllowance: 23500, otherAllowance: 0,
        grossSalary: 50000, pf: 2100, pt: 200, leaveDeduction: 0, otherDeduction: 0, deductions: 2300, netSalary: 47700, others: [] });

      expect(prisma.payroll.findUnique).toHaveBeenCalledWith({ where: { id: 7 }, include: { employee: true, others: true } });
      for (const amount of ['17,500.00', '7,000.00', '2,000.00', '23,500.00', '47,700.00']) expect(html).toContain(amount);
    });

    it('uses the official Palate Networks branding, never the configured company name or logo', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        companyName: 'FooDeeZ', companyLogo: 'https://example.com/foodeez.png', companyAddress: 'Hyderabad, India',
        currency: 'INR', timeZone: 'Asia/Kolkata',
      });

      const html = await render(basePayroll);

      expect(html).toContain(`src="${PAYSLIP_LOGO_DATA_URI}"`);
      expect(html).toContain('alt="Palate Networks"');
      expect(html).toContain('<title>Payslip - September 2026 - Palate Networks</title>');
      expect(html).toContain('Hyderabad, India');
      expect(html).not.toMatch(/foodeez/i);
      expect(html).toContain('This is a computer-generated payslip and does not require a signature.');
    });

    it('embeds the official logo image unchanged (453 x 81 PNG)', () => {
      const png = Buffer.from(PAYSLIP_LOGO_DATA_URI.replace('data:image/png;base64,', ''), 'base64');
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([PAYSLIP_LOGO_WIDTH, PAYSLIP_LOGO_HEIGHT]);
      expect([PAYSLIP_LOGO_WIDTH, PAYSLIP_LOGO_HEIGHT]).toEqual([453, 81]);
    });

    it.each([
      [{ firstName: 'Rahul', lastName: 'Kumar' }, 'Rahul_Kumar_Payslip_September_2026.pdf'],
      [{ firstName: '  Anu  Priya ', lastName: 'Rao' }, 'Anu_Priya_Rao_Payslip_September_2026.pdf'],
      [{ firstName: 'Ravi/..\\', lastName: 'K:*?"<>|' }, 'Ravi_K_Payslip_September_2026.pdf'],
      [{ firstName: 'राहुल', lastName: 'कुमार', empCode: 'EMP/042' }, 'EMP_042_Payslip_September_2026.pdf'],
    ])('names the download after the employee and period: %j', async (employee, expected) => {
      await render({ ...basePayroll, employee: { ...basePayroll.employee, ...employee } });

      expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="${expected}"`);
    });

    it('waits for the embedded logo before printing the PDF', async () => {
      prisma.payroll.findUnique.mockResolvedValue(basePayroll);
      const page = { setContent: jest.fn(), pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
      launch.mockResolvedValue({ newPage: jest.fn().mockResolvedValue(page), close: jest.fn() });

      await service.generatePayslip(7, response);
      expect(page.setContent).toHaveBeenCalledWith(expect.any(String), { waitUntil: 'load' });
    });

    it('does not show a revision line for an original payslip', async () => {
      await expect(render(basePayroll)).resolves.not.toContain('Revised payslip');
    });
  });
});
