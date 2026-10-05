import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../.env') });
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.THROTTLE_LIMIT = '1000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.WEB_URL = 'http://web.test';
