require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

async function main() {
  const prisma = new PrismaClient();
  try {
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;

    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, password: true },
    });

    const missing = users.filter((u) => !u.password);
    if (missing.length === 0) {
      console.log('No active users with missing passwords.');
      return;
    }

    console.log(`Found ${missing.length} active users with missing passwords:`);

    for (const u of missing) {
      const raw = Math.random().toString(36).slice(-10);
      const hashed = await bcrypt.hash(raw, bcryptRounds);
      await prisma.user.update({ where: { id: u.id }, data: { password: hashed } });
      console.log(`- ${u.email} -> password: ${raw}`);
    }

    console.log('\nDone. Distribute the printed passwords securely to the users and ask them to change it on first login.');
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
