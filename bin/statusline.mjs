#!/usr/bin/env node
// statusLine entry — reads Claude Code's statusLine JSON on stdin and prints a
// one-line context+cost HUD. Must NEVER crash (a thrown statusLine breaks the
// prompt), so everything is defensive and falls back to a quiet label.

import { readFileSync } from 'node:fs';
import { fromStatusline } from '../src/context.mjs';
import { renderStatusline, colorEnabled } from '../src/format.mjs';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

try {
  const raw = readStdin();
  const stdin = raw ? JSON.parse(raw) : {};
  const parsed = fromStatusline(stdin);
  const on = process.env.NO_COLOR ? false : colorEnabled(process.stdout);
  if (!parsed.signal.usedPercent && !parsed.costUsd && !parsed.signal.windowSize) {
    process.stdout.write('tokenomics');
  } else {
    process.stdout.write(renderStatusline(parsed, on));
  }
} catch {
  process.stdout.write('tokenomics');
}
