import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {PvpBattle} from '../engine.mjs';

// Keep the real simulator, relay and controls; let the test finish each animation explicitly.
const stubs = {
  './ui.mjs': 'export function render(state) { window.loading = state; } export function key() {}',
  './gfx.mjs': 'export async function loadArt() { return {}; }',
  './scene.mjs': 'export class Scene { constructor() { this.message = {}; } size() { return [240,160]; } wrap(text) { return [text]; } }',
  './screen.mjs': 'export class Screen { mount() {} }',
  './effects.mjs': 'export class Effects {}',
  './anim.mjs': 'export class Clock { skip() {} finish() {} }',
  './playback.mjs': `export class Playback {
    constructor(options) { this.options = options; }
    run(lines) { return new Promise(done => window.animations.push({lines, done})); }
    clearMessage() {}
  }`,
};
const built = await build({entryPoints: [fileURLToPath(new URL('../browser.mjs', import.meta.url))], write: false,
  bundle: true, platform: 'browser', format: 'iife', plugins: [{name: 'test-presentation', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => args.importer.endsWith('browser.mjs') && stubs[args.path]
      ? {path: args.path, namespace: 'presentation'} : undefined);
    builder.onLoad({filter: /.*/, namespace: 'presentation'}, args => ({contents: stubs[args.path], loader: 'js'}));
  }}]});
const source = built.outputFiles[0].text;
const config = {mode: 'pvp', battle: 'test', format: 'random_singles', seed: [12, 34, 56, 78], side: 0,
  players: [{id: 1, name: 'Riley'}, {id: 2, name: 'Sam'}]};
const flush = () => new Promise(resolve => setImmediate(resolve));

async function phone(side = 0) {
  const choices = [], results = [], frames = [];
  let forfeits = 0;
  const window = {animations: [], DomeNative: {
    ready() {}, close() {}, frame(value) { frames.push(JSON.parse(value)); },
    pvpChoice(turn, choice, check) { choices.push({type: 'choice', side, turn, choice, check}); },
    pvpResult(winner, check) { results.push({winner, check}); }, pvpForfeit() { forfeits++; },
  }};
  runInNewContext(source, {window, document: {getElementById() { return {}; }}, console, setTimeout, structuredClone});
  window.DomeApp.boot({...config, side});
  await flush();
  return {window, choices, results, get state() { return frames.at(-1); }, get forfeits() { return forfeits; },
    async finish() { window.animations.shift().done(); await flush(); },
    tap(target) { window.DomeApp.action({type: 'tap', target}); },
  };
}

test('PvP skips setup, sends a choice once, waits by name, and ignores its own echo during forfeit confirmation', async () => {
  const view = await phone();
  assert.equal(view.window.loading.pvp, true);
  assert.equal(view.window.loading.formats, undefined);
  await view.finish();
  assert.equal(view.state.ui.mode, 'action');
  view.tap(0);
  view.tap(view.state.ui.moves.findIndex(move => move && !move.disabled));
  if (view.state.ui.mode === 'yesno') view.tap(1);
  assert.equal(view.choices.length, 1);
  assert.equal(view.choices[0].turn, 1);
  await view.finish();
  assert.equal(view.state.ui.mode, 'wait');
  assert.equal(view.state.message, 'Waiting for Sam...');
  view.window.DomeKey('back');
  view.window.DomePvp.receive(view.choices[0]);
  assert.equal(view.state.ui.mode, 'yesno');
  view.tap(0);
  assert.equal(view.forfeits, 1);
  assert.equal(view.results.length, 0);
  assert.equal(view.state.rewardPending, false);
});

test('choices and server endings received during playback wait for it without overlapping animations', async () => {
  const view = await phone(1);
  const remote = new PvpBattle({...config, side: 0});
  const event = {type: 'choice', side: 0, turn: 1, choice: 'default', check: remote.checkHash()};
  view.window.DomePvp.receive(event);
  assert.equal(view.window.animations.length, 1);
  assert.equal(view.state.playing, true);
  await view.finish();
  assert.equal(view.state.battle.player.name, 'Sam');
  assert.equal(view.state.ui.mode, 'action');
  assert.equal(view.window.animations.length, 0);
  const opening = await phone(1);
  opening.window.DomePvp.receive({type: 'end', winner: 1, reason: 'Riley forfeited'});
  assert.equal(opening.state.playing, true);
  await opening.finish();
  assert.equal(opening.state.ui.mode, 'ended');
  assert.match(opening.state.ui.text, /Sam won! Riley forfeited/);
  assert.equal(opening.state.rewardPending, false);
  assert.equal(opening.results.length, 0);
});
