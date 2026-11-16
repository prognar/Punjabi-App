import { defineConfig } from 'vitest/config';

// The learner simulations use local calendar days; pin the zone so results are the same everywhere.
process.env.TZ = 'UTC';

export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
