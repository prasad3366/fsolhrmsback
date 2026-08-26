import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@example.com' },
  });

  if (existingAdmin) {
    console.log('Admin user already exists. Skipping creation.');
  } else {
    const password = 'admin123';
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;
    const hashedPassword = await bcrypt.hash(password, bcryptRounds);

    const adminUser = await prisma.user.create({
      data: {
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'ADMIN',
        isActive: true,
      },
    });

    console.log('✅ Admin user created successfully!');
    console.log('Email:', adminUser.email);
    console.log('Password:', password);
  }

  // Leave policy according to company rules
  const leaveTypes = [
    {
      name: 'Casual Leave',
      yearlyQuota: 10,   // ✅ Correct according to policy
      carryForward: true,
      maxCarryLimit: 2,
      requiresMedical: false,
    },
    {
      name: 'Sick Leave',
      yearlyQuota: 8,
      carryForward: true,
      maxCarryLimit: 1,
      requiresMedical: true, // ✅ Medical certificate required
    },
    {
      name: 'Maternity Leave',
      yearlyQuota: 182,
      carryForward: false,
      maxCarryLimit: 0,
      requiresMedical: false,
    },
  ];

  for (const type of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { name: type.name },
      update: {
        yearlyQuota: type.yearlyQuota,
        carryForward: type.carryForward,
        maxCarryLimit: type.maxCarryLimit,
        requiresMedical: type.requiresMedical,
      },
      create: type,
    });
  }

  console.log('✅ Leave types created/updated successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });