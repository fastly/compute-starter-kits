import { buildFire } from '@fastly/hono-fastly-compute';
import { app } from './app';

const fire = buildFire({
  kitsStorage: 'KVStore:compute_starter_kits'
});

fire(app);
