// Copyright 2026 Mark Guertin. Licensed under the Apache License, Version 2.0 (see LICENSE).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
});
