#!/usr/bin/env node
/**
 * Cross-platform front door for GPU training commands.
 *
 * macOS can build/lint/evaluate the dataset, but this repository's QLoRA path
 * uses CUDA + bitsandbytes and therefore requires an NVIDIA GPU. Windows uses
 * the existing PowerShell supervisor; Linux may run the probe directly.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI = dirname(HERE);
const mode = process.argv[2];
const extra = process.argv.slice(3);

function fail(message) {
  console.error('\nMGL AI training environment\n');
  console.error(message);
  process.exit(2);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: AI, stdio: 'inherit', shell: false });
  if (r.error) fail(`Failed to start ${cmd}: ${r.error.message}`);
  process.exit(r.status ?? 1);
}

if (mode === 'probe') {
  if (process.platform === 'darwin') {
    fail(
      'This QLoRA probe requires NVIDIA CUDA/bitsandbytes. macOS/Apple Silicon can prepare the SFT corpus, but cannot run this CUDA training pipeline.\n' +
      'Run ai:train:probe on the RTX/NVIDIA workstation after pulling this branch.'
    );
  }
  const py = process.platform === 'win32'
    ? join(HERE, '.venv', 'Scripts', 'python.exe')
    : join(HERE, '.venv', 'bin', 'python');
  if (!existsSync(py)) {
    fail(`Training virtualenv Python not found: ${py}\nCreate/install ai/training/.venv on the NVIDIA workstation first.`);
  }
  run(py, ['-X', 'utf8', join(HERE, 'memory_probe.py'), ...extra]);
}

if (mode === 'background') {
  if (process.platform === 'darwin') {
    fail(
      'Actual Qwen3-8B QLoRA training requires the NVIDIA CUDA workstation.\n' +
      'On this Mac run only ai:build:sft / ai:train:readiness / static evaluations, then pull the same branch on the RTX PC.'
    );
  }
  if (process.platform !== 'win32') {
    fail(
      'The supervised background trainer is currently Windows/PowerShell-specific.\n' +
      'Use the configured Windows RTX workstation, or run train_lora.py directly on a prepared Linux CUDA host.'
    );
  }
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'train.ps1'), ...extra]);
}

fail('Usage: node training/platform-run.mjs <probe|background> [args...]');
