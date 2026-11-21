import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SOLO_BOARD_SIZE } from '../shared/protocol';
import { createSavedSoloBoard, loadSoloBoard, SoloBoard as RealBoard, type SoloSubmitOutcome } from './soloBoard';

/** A board whose `submit` answers are known not to be refusals (the refusal test uses `RealBoard`). */
class SoloBoard extends RealBoard {
  override submit(name: string, score: number, runId: string, now?: number): SoloSubmitOutcome {
    return super.submit(name, score, runId, now) as SoloSubmitOutcome;
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), 'pts-solo-'));
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('SoloBoard', () => {
  it('keeps only the best score of a name and ranks it', () => {
    const b = new SoloBoard();
    expect(b.submit('An', 100, 'r1', 1)).toMatchObject({ rank: 1, best: 100, improved: true, onBoard: true });
    expect(b.submit('Binh', 150, 'r2', 2)).toMatchObject({ rank: 1, best: 150, improved: true, onBoard: true });
    // A worse run of An changes nothing and still reports An's best and rank.
    expect(b.submit('An', 40, 'r3', 3)).toMatchObject({ rank: 2, best: 100, improved: false, onBoard: true });
    expect(b.submit('An', 200, 'r4', 4)).toMatchObject({ rank: 1, best: 200, improved: true, onBoard: true });
    const v = b.view();
    expect(v.total).toBe(2);
    expect(v.entries.map(e => [e.name, e.score])).toEqual([['An', 200], ['Binh', 150]]);
  });

  it('treats names as the same after trimming, collapsing spaces and ignoring case', () => {
    const b = new SoloBoard();
    b.submit('Dũng  Đẹp', 10, 'a', 1);
    const r = b.submit('  dũng đẹp ', 30, 'b', 2);
    expect(r.improved).toBe(true);
    expect(b.view().total).toBe(1);
    expect(b.view().entries[0]).toMatchObject({ name: 'dũng đẹp', score: 30 });
  });

  it('counts a runId once, so a resend is harmless', () => {
    let saves = 0;
    const b = new SoloBoard(() => { saves++; });
    b.submit('An', 100, 'same', 1);
    // The resend reads like the first answer (a record stays a record), not "no change".
    expect(b.submit('An', 100, 'same', 2)).toMatchObject({ rank: 1, best: 100, improved: true, onBoard: true });
    // Even a higher score under a seen runId is ignored.
    expect(b.submit('An', 999, 'same', 3).changed).toBe(false);
    expect(b.view().entries[0]!.score).toBe(100);
    expect(saves).toBe(1);
  });

  it('shares a rank between equal scores and shows at most the top 50', () => {
    const b = new SoloBoard();
    b.submit('a', 50, '1', 1);
    b.submit('b', 50, '2', 2);
    expect(b.submit('c', 10, '3', 3).rank).toBe(3);
    for (let i = 0; i < 60; i++) b.submit(`p${i}`, i + 100, `x${i}`, 10 + i);
    const v = b.view();
    expect(v.entries).toHaveLength(SOLO_BOARD_SIZE);
    expect(v.total).toBe(63);
    expect(v.entries[0]!.score).toBe(159);
  });

  it('reset empties the board and keeps old run ids from coming back', () => {
    const b = new SoloBoard();
    b.submit('An', 100, 'old', 1);
    b.reset();
    expect(b.view()).toEqual({ entries: [], total: 0 });
    expect(b.submit('An', 100, 'old', 2).improved).toBe(true);
    expect(b.view().total).toBe(0);
  });

  it('survives a JSON round trip, including the seen run ids', () => {
    const b = new SoloBoard();
    b.submit('An', 100, 'r1', 1);
    b.submit('Binh', 90, 'r2', 2);
    const c = new SoloBoard(undefined, JSON.parse(JSON.stringify(b)));
    expect(c.view()).toEqual(b.view());
    expect(c.submit('An', 100, 'r1', 3)).toMatchObject({ improved: true, rank: 1 });
  });

  it('refuses a runId already counted for another name', () => {
    const b = new RealBoard();
    b.submit('An', 100, 'r1', 1);
    expect(b.submit('Binh', 500, 'r1', 2)).toEqual({ refused: 'runIdUsed' });
    expect(b.view().total).toBe(1);
  });

  it('keeps at most maxEntries names: a lower score gets its rank but is not stored', () => {
    const b = new RealBoard(undefined, undefined, 3);
    for (const [n, sc] of [['a', 10], ['b', 20], ['c', 30]] as const) b.submit(n, sc, n, 1);
    expect(b.submit('low', 5, 'low', 2)).toMatchObject({ rank: 4, best: 5, improved: false, onBoard: false });
    expect(b.view().total).toBe(3);
    // A better score pushes the lowest out.
    expect(b.submit('high', 25, 'high', 3)).toMatchObject({ rank: 2, improved: true, onBoard: true });
    expect(b.view().entries.map(e => e.name)).toEqual(['c', 'high', 'b']);
    // Many junk names never grow it.
    for (let i = 0; i < 500; i++) b.submit(`junk${i}`, i % 7, `j${i}`, 10);
    expect(b.view().total).toBe(3);
  });
});

describe('the solo board file', () => {
  it('batches saves: submissions in one window share one write', async () => {
    const file = path.join(tmp, 'batch', 'solo.json');
    const s = createSavedSoloBoard(file, () => {}, 10, 30);
    s.board.submit('An', 1, 'r1', 1);
    const a = s.commit();
    s.board.submit('Binh', 2, 'r2', 2);
    expect(s.commit()).toBe(a);
    expect(await a).toBe(true);
    expect(loadSoloBoard(file).view().total).toBe(2);
  });

  it('saves atomically and loads the same board back', async () => {
    const file = path.join(tmp, 'a', 'solo-board.json');
    const s = createSavedSoloBoard(file, () => {}, 10);
    s.board.submit('An', 123, 'r1', 5);
    expect(await s.flush()).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
    expect(loadSoloBoard(file).view().entries).toEqual([{ name: 'An', score: 123, at: 5 }]);
  });

  it('starts empty without a file', () => {
    expect(loadSoloBoard(path.join(tmp, 'missing.json')).view()).toEqual({ entries: [], total: 0 });
  });

  it('renames a corrupt file to .corrupt and starts empty', () => {
    const file = path.join(tmp, 'bad.json');
    writeFileSync(file, '{ not json');
    const logs: string[] = [];
    const b = loadSoloBoard(file, undefined, m => logs.push(m));
    expect(b.view().total).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('{ not json');
    expect(logs).toHaveLength(1);
  });

  it('also treats well-formed JSON of the wrong shape as corrupt', () => {
    const file = path.join(tmp, 'shape.json');
    writeFileSync(file, JSON.stringify({ entries: [{ name: 5 }], seen: [] }));
    expect(loadSoloBoard(file, undefined, () => {}).view().total).toBe(0);
    expect(existsSync(`${file}.corrupt`)).toBe(true);
  });
});
