#!/usr/bin/env node

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🚀 Starting ATP Enterprise Portal...');

try {
  // Serve the production build using 'serve'
  execSync('npx serve -s dist -p 5173', { cwd: projectRoot, stdio: 'inherit' });
} catch (error) {
  console.error('Failed to start the portal:', error.message);
  process.exit(1);
}
