import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('tests').filter(name => /\.test\.(ts|cjs)$/.test(name)).sort().map(name => `tests/${name}`);
if (!files.length) throw new Error('No behavioral tests found');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
