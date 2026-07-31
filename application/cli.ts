#!/usr/bin/env node

import { runLocalCommand } from './LocalCommandInvocation.js';

process.exitCode = runLocalCommand(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
});
