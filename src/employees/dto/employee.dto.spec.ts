import { validate } from 'class-validator';
import { UpdateEmployeeDto } from './create-employee.dto';

describe('Employee DTO validation', () => {
  it('retains and validates optional model-backed fields', async () => {
    const dto = Object.assign(new UpdateEmployeeDto(), {
      sourceOfHire: 'Referral',
      currentExperience: 2.5,
      reportingManager: 'EMP001',
      dateOfBirth: '1990-01-01',
      age: 35,
      currentAddress: 'Current address',
      permanentAddress: 'Permanent address',
      pincode: '123456',
      city: 'Pune',
      phone: '1234567890',
      personalMobile: '0987654321',
      panNumber: 'ABCDE1234F',
      aadharNumber: '123412341234',
      pfNumber: 'PF123',
      uanNumber: 'UAN123',
      bankAccountNumber: '123456789',
      bankName: 'Example Bank',
      ifscCode: 'EXMP0001234',
      dateOfExit: '2030-01-01',
      isExperienced: true,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid values for optional model-backed fields', async () => {
    const dto = Object.assign(new UpdateEmployeeDto(), {
      sourceOfHire: 123,
      currentExperience: 'not-a-number',
      dateOfBirth: 'not-a-date',
      age: 'not-a-number',
      isExperienced: 'true',
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'sourceOfHire',
        'currentExperience',
        'dateOfBirth',
        'age',
        'isExperienced',
      ]),
    );
  });

  it('allows a partial update payload without requiring create fields', async () => {
    const dto = Object.assign(new UpdateEmployeeDto(), {
      city: 'Pune',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
