"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Starting database seed...');
    const existingAdmin = await prisma.user.findUnique({
        where: { email: 'admin@example.com' },
    });
    if (existingAdmin) {
        console.log('Admin user already exists. Skipping creation.');
    }
    else {
        const password = 'admin123';
        const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;
        const hashedPassword = await bcrypt.hash(password, bcryptRounds);
        const adminUser = await prisma.user.create({
            data: {
                email: 'admin@example.com',
                password: hashedPassword,
                role: 'SUPER_ADMIN',
                isActive: true,
            },
        });
        console.log('✅ Admin user created successfully!');
        console.log('Email:', adminUser.email);
        console.log('Password:', password);
    }
    const leaveTypes = [
        {
            name: 'Casual Leave',
            yearlyQuota: 10,
            carryForward: true,
            maxCarryLimit: 2,
            requiresMedical: false,
        },
        {
            name: 'Sick Leave',
            yearlyQuota: 8,
            carryForward: true,
            maxCarryLimit: 1,
            requiresMedical: true,
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
//# sourceMappingURL=seed.js.map