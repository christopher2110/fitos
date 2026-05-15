#!/usr/bin/env node
// scripts/skills-scan.js
// Validates all skill manifests in /skills/ and prints a summary.
// Run via: npm run skills:scan
// Exit 1 if any manifest is missing required fields or is malformed JSON.

const fs   = require('fs');
const path = require('path');

const SKILLS_DIR     = path.join(__dirname, '..', 'skills');
const REQUIRED_FIELDS = ['id', 'name', 'description', 'version', 'model', 'inputs', 'outputs'];

let exitCode = 0;
let found    = 0;
let valid    = 0;

if (!fs.existsSync(SKILLS_DIR)) {
  console.error('skills/ directory not found. Create it and add skill folders.');
  process.exit(1);
}

const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());

if (entries.length === 0) {
  console.log('No skill folders found in skills/. Drop a skill folder (manifest.json + system.md) to get started.');
  process.exit(0);
}

for (const dir of entries) {
  const skillDir    = path.join(SKILLS_DIR, dir.name);
  const manifestPath = path.join(skillDir, 'manifest.json');
  const systemPath   = path.join(skillDir, 'system.md');
  found++;

  const errors = [];

  if (!fs.existsSync(manifestPath)) errors.push('missing manifest.json');
  if (!fs.existsSync(systemPath))   errors.push('missing system.md');

  if (errors.length === 0) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      errors.push(`manifest.json is not valid JSON: ${e.message}`);
    }

    if (manifest) {
      for (const field of REQUIRED_FIELDS) {
        if (manifest[field] === undefined) errors.push(`missing required field: "${field}"`);
      }
      // Warn if id doesn't match folder name
      if (manifest.id && manifest.id !== dir.name) {
        errors.push(`manifest.id "${manifest.id}" does not match folder name "${dir.name}"`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`FAIL  ${dir.name}`);
    for (const e of errors) console.error(`        ${e}`);
    exitCode = 1;
  } else {
    console.log(`OK    ${dir.name}`);
    valid++;
  }
}

console.log(`\n${valid}/${found} skills valid.`);
if (exitCode !== 0) {
  console.error('Fix the errors above before deploying.');
}
process.exit(exitCode);
