import type { NextConfig } from 'next';
import { join } from 'path';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(__dirname, '../..'),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
