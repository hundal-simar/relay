process.env.NODE_ENV = "test";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
process.env.DB_HOST = "localhost";
process.env.DB_NAME = "relay_test";
process.env.REDIS_HOST = "localhost";