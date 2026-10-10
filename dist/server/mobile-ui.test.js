import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const load = name => readFile(new URL(`../dist/${name}`, import.meta.url),'utf8');

test('mobile actions remain readable and the companion becomes a corner button',async () => {
  const css=await load('styles.css');
  assert.match(css,/@media \(max-width: 640px\)[\s\S]*\.nx-topbar \.nx-primary-button/);
  assert.match(css,/@media \(max-width: 480px\)[\s\S]*\.nx-pattern-source-actions/);
  assert.match(css,/\.nx-vault-uploader > \.nx-primary-button/);
  assert.match(css,/\.nx-avatar-rail[\s\S]*bottom: 16px/);
});

test('mobile breadcrumb can hide its desktop-only root label',async () => {
  const app=await load('app.js');
  assert.match(app,/class="nx-breadcrumb-root"/);
});
