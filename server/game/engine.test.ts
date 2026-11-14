import { describe, expect, it } from 'vitest';
import { GameRoom } from './engine';
import { mulberry32 } from './random';

const mk = () => {
  let t = 1000;
  const room = new GameRoom({ now: () => t, random: mulberry32(9) });
  return { room, tick: (ms: number) => (t += ms) };
};
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error('expected ok');
  return r as Extract<T, { ok: true }>;
};

describe('GameRoom', () => {
  it('validates nicknames and resumes by token', () => {
    const { room } = mk();
    expect(room.join('   ').ok).toBe(false);
    expect(room.join('x'.repeat(21)).ok).toBe(false);
    const j = ok(room.join('  Dũng   Nguyễn '));
    expect(room.snapshot().players[0].nickname).toBe('Dũng Nguyễn');
    expect(room.snapshot().players[0].shopName).toContain('Dũng Nguyễn');
    expect(room.resume(j.token)).toBe(j.playerId);
    expect(room.resume('nope')).toBeNull();
  });

  it('walks through all phases', () => {
    const { room } = mk();
    room.join('A');
    const seen: string[] = [];
    for (let i = 0; i < 13; i++) { seen.push(`${room.phase}:${room.roundIndex}`); room.next(); }
    expect(seen).toEqual([
      'lobby:-1', 'event:0', 'pricing:0', 'reveal:0', 'event:1', 'pricing:1', 'reveal:1',
      'event:2', 'pricing:2', 'reveal:2', 'event:3', 'pricing:3', 'reveal:3',
    ]);
    expect(room.phase).toBe('awards');
    room.next();
    expect(room.phase).toBe('awards');
  });

  it('sets a 20s deadline when pricing opens', () => {
    const { room } = mk();
    room.join('A'); room.next(); room.next();
    expect(room.deadline).toBe(1000 + 20_000);
  });

  it('accepts prices only during pricing and within the round cap', () => {
    const { room } = mk();
    const { playerId } = ok(room.join('A'));
    expect(room.submitPrice(playerId, 30).ok).toBe(false);
    room.next(); room.next();
    expect(room.submitPrice(playerId, 9).ok).toBe(false);
    expect(room.submitPrice(playerId, 51).ok).toBe(false);
    expect(room.submitPrice(playerId, 30.5).ok).toBe(false);
    expect(room.submitPrice(playerId, 30).ok).toBe(true);
    expect(room.snapshot().players[0].submitted).toBe(true);
    room.next(); room.next(); room.next();
    expect(room.submitPrice(playerId, 21).ok).toBe(false);
    expect(room.submitPrice(playerId, 20).ok).toBe(true);
  });

  it('scores a lone shop deterministically', () => {
    const { room } = mk();
    const { playerId } = ok(room.join('A'));
    room.next(); room.next(); room.submitPrice(playerId, 30); room.next();
    const r = room.snapshot().lastResult!;
    expect(r.customers).toBe(15);
    expect(r.shops[0]).toMatchObject({ price: 30, sold: 10, profit: 150 });
    expect(room.snapshot().players[0].total).toBe(150);
  });

  it('defaults to 25k, then keeps the last price, clamped by the ceiling', () => {
    const { room } = mk();
    const { playerId } = ok(room.join('A'));
    room.next(); room.next(); room.next();
    expect(room.snapshot().lastResult!.shops[0].price).toBe(25);
    room.next(); room.next(); room.next();
    expect(room.snapshot().lastResult!.shops[0].price).toBe(20);
    room.next(); room.next(); room.submitPrice(playerId, 40); room.next();
    room.next(); room.next(); room.next();
    expect(room.snapshot().lastResult!.shops[0].price).toBe(40);
    expect(room.snapshot().lastResult!.customers).toBe(8);
  });

  it('counts poll votes and allows changing a vote', () => {
    const { room } = mk();
    const a = ok(room.join('A')).playerId, b = ok(room.join('B')).playerId;
    room.vote(a, 'invisible'); room.vote(b, 'invisible'); room.vote(b, 'visible');
    expect(room.snapshot().poll).toEqual({ invisible: 1, visible: 1 });
  });

  it('ranks by total and builds awards at the end', () => {
    const { room } = mk();
    const a = ok(room.join('A')).playerId, b = ok(room.join('B')).playerId;
    room.next();
    for (let r = 0; r < 4; r++) {
      room.next();
      room.submitPrice(a, 12 + r);
      room.submitPrice(b, r === 1 ? 20 : 45);
      room.next(); room.next();
    }
    const s = room.snapshot();
    expect(s.phase).toBe('awards');
    expect(s.players[0].rank).toBe(1);
    expect(s.players[0].total).toBeGreaterThanOrEqual(s.players[1].total);
    expect(s.awards.map(x => x.id)).toContain('tycoon');
  });

  it('reset returns to lobby and keeps players and votes', () => {
    const { room } = mk();
    const a = ok(room.join('A')).playerId;
    room.vote(a, 'visible');
    room.next(); room.next(); room.next();
    room.reset();
    const s = room.snapshot();
    expect(s.phase).toBe('lobby');
    expect(s.roundIndex).toBe(-1);
    expect(s.lastResult).toBeNull();
    expect(s.players[0].total).toBe(0);
    expect(s.poll.visible).toBe(1);
  });
});
