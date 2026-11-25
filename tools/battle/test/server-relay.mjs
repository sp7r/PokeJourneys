// Two players battle through a running PokeJourneys server (started with --dev-signin), each with its own engine,
// exchanging only choices through /api/battles, as two phones would. Usage: node test/server-relay.mjs <server url>
import {PvpBattle} from '../engine.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5290';
const signIn = async name => (await (await fetch(base + '/api/auth/dev', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})})).json()).sessionToken;
const players = [{name: 'Relay A'}, {name: 'Relay B'}];
for (const p of players) p.token = await signIn(p.name);
const call = async (p, method, path, body) => {
  const answer = await fetch(base + path, {method, headers: {Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
  const text = await answer.text();
  if (!answer.ok) throw Error(`${path}: ${answer.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const me = await Promise.all(players.map(p => call(p, 'GET', '/api/me')));
for (const [i, p] of players.entries()) p.id = me[i].id;

// Both on the island; A asks B to battle, B accepts; both get battle_start.
await Promise.all(players.map(p => new Promise(resolve => {
  p.inbox = [];
  p.ws = new WebSocket(base.replace('http', 'ws') + '/api/live', {headers: {Authorization: 'Bearer ' + p.token}});
  p.ws.onmessage = e => p.inbox.push(JSON.parse(e.data));
  p.ws.onopen = () => { p.ws.send(JSON.stringify({type: 'move', room: 'island', x: 5, y: 5, facing: 'down'})); resolve(); };
})));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (p, type) => { for (let i = 0; i < 100; i++) { const m = p.inbox.find(m => m.type === type); if (m) return m; await wait(50); } throw Error(p.name + ' never got ' + type); };
await wait(300);
players[0].ws.send(JSON.stringify({type: 'request', to: players[1].id, kind: 'battle'}));
const request = await until(players[1], 'request');
players[1].ws.send(JSON.stringify({type: 'answer', id: request.id, accept: true}));
for (const p of players) {
  p.start = await until(p, 'battle_start');
  p.battle = new PvpBattle({format: p.start.format, seed: p.start.seed, players: p.start.players, side: p.start.side});
  p.turn = 0; p.after = 0;
}
const id = players[0].start.battle;
console.log('battle', id, 'seed', players[0].start.seed.join(','));

// Each player picks the first legal option when asked, posts it, and applies the other's choices from the events.
let rounds = 0;
while (!players[0].battle.battle.ended && rounds++ < 400) {
  for (const p of players) {
    const state = p.battle.state();
    if (state.ended || state.wait || !state.slots.length) continue;
    p.turn++;
    p.battle.choose(p.start.side, 'default');
    await call(p, 'POST', `/api/battles/${id}/choice`, {turn: p.turn, choice: 'default', check: p.battle.checkHash()});
  }
  for (const p of players) {
    const {events, next} = await call(p, 'GET', `/api/battles/${id}/events?after=${p.after}`);
    p.after = next;
    for (const e of events) if (e.type === 'choice' && e.side !== p.start.side) p.battle.choose(e.side, e.choice);
  }
}
const results = players.map(p => ({winner: p.battle.winner, check: p.battle.checkHash()}));
console.log('rounds', rounds, 'results', JSON.stringify(results));
for (const [i, p] of players.entries()) await call(p, 'POST', `/api/battles/${id}/result`, results[i]);
const {events} = await call(players[0], 'GET', `/api/battles/${id}/events?after=0`);
console.log('end event', JSON.stringify(events.find(e => e.type === 'end')));
process.exit(0);
