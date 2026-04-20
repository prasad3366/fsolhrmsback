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
    return;
  }

  // Hash the password
  const password = 'admin123'; // Change this to your desired password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create admin user
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
  console.log('Role:', adminUser.role);
  console.log('Password:', password); // Only shown during seed

  // Create leave types
  const leaveTypes = [
    { name: 'Casual Leave', yearlyQuota: 12, carryForward: true, maxCarryLimit: 2 },
    { name: 'Sick Leave', yearlyQuota: 8, carryForward: true, maxCarryLimit: 1 },
    { name: 'Maternity Leave', yearlyQuota: 182, carryForward: false, maxCarryLimit: null },
  ];

  for (const type of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { name: type.name },
      update: {
        yearlyQuota: type.yearlyQuota,
        carryForward: type.carryForward,
        maxCarryLimit: type.maxCarryLimit,
      },
      create: type,
    });
  }

  console.log('✅ Leave types created successfully!');
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