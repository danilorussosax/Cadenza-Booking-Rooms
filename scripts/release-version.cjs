#!/usr/bin/env node
'use strict';

// Compute SemVer from conventional commits since the current release tag.
// Updates package/lock metadata only; commit, tag, release and deploy remain explicit.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const folders = ['', 'backend', 'frontend', 'e2e'];
const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error('Expected a stable SemVer version');
const tags = git('tag', '--list').split('\n');
const baseline = tags.includes(`v${current}`)
  ? `v${current}`
  : git('log', '-1', '--format=%H', '--', 'package.json');
const commits = git('log', `${baseline}..HEAD`, '--format=%s%n%b');
if (!commits) throw new Error('No committed changes since the current release');
const bump = /BREAKING CHANGE:|^[a-z]+(?:\([^\n]*\))?!:/m.test(commits)
  ? 'major'
  : /^feat(?:\([^\n]*\))?:/m.test(commits)
    ? 'minor'
    : 'patch';
const [major, minor, patch] = current.split('.').map(Number);
const version =
  bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
if (tags.includes(`v${version}`)) throw new Error(`Tag v${version} already exists`);
const updates = [];
for (const folder of folders) {
  for (const name of ['package.json', 'package-lock.json']) {
    const file = path.join(root, folder, name);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== current) throw new Error(`Version mismatch: ${file}`);
    data.version = version;
    if (name === 'package-lock.json' && data.packages?.['']) data.packages[''].version = version;
    updates.push([file, JSON.stringify(data, null, 2) + '\n']);
  }
}
if (!process.argv.includes('--dry-run')) {
  for (const [file, contents] of updates) fs.writeFileSync(file, contents);
}
console.log(
  JSON.stringify({
    previous: current,
    version,
    bump,
    baseline,
    dryRun: process.argv.includes('--dry-run'),
  }),
);
