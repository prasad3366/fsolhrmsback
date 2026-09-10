export const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

export function parseAllowedOrigins(): string[] {
  const envValue = process.env.FRONTEND_URL || '';

  const parsed = envValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set([...parsed, ...defaultAllowedOrigins]));
}

export function buildCorsOptions() {
  const allowedOrigins = parseAllowedOrigins();

  return {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}
