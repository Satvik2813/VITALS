import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';
import path from 'node:path';
loadEnvConfig(path.resolve(process.cwd(), process.cwd().endsWith('web') ? '../..' : '.'));
const config: NextConfig = { poweredByHeader: false, devIndicators: false };
export default config;
