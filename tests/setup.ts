// Test environment defaults. Real values come from .env in dev and from docker-compose in production.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:54329/test";
process.env.APP_SECRET ??= "dGVzdC1hcHAtc2VjcmV0LXRoYXQtaXMtYXQtbGVhc3QtMzItYnl0ZXMtbG9uZw==";
process.env.TZ = "Europe/Amsterdam";
