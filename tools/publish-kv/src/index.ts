import { run } from './lib.ts';

run({ force: process.argv.includes('--force') });
