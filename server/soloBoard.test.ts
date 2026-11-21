import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SOLO_BOARD_SIZE } from '../shared/protocol';
import { createSavedSoloBoard, loadSoloBoard, SoloBoard } from './soloBoard';

const tmp = mkdtempSync(path.join(tmpdir(), 'pts-solo-'));
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('SoloBoard', () => {
  it('keeps only the best score of a name and ranks it', () => {
    const b = new SoloBoard();
    expect(b.submit('An', 100, 'r1', 1)).toEqual({ rank: 1, best: 100, improved: true });
    expect(b.submit('Binh', 150, 'r2', 2)).toEqual({ rank: 1, best: 150, improved: true });
    // A worse run of An changes nothing and still reports An's best and rank.
    expect(b.submit('An', 40, 'r3', 3)).toEqual({ rank: 2, best: 100, improved: false });
    expect(b.submit('An', 200, 'r4', 4)).toEqual({ rank: 1, best: 200, improved: true });
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
    expect(b.submit('An', 100, 'same', 2)).toEqual({ rank: 1, best: 100, improved: false });
    // Even a higher score under a seen runId is ignored.
    expect(b.submit('An', 999, 'same', 3).improved).toBe(false);
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
    expect(b.submit('An', 100, 'old', 2).improved).toBe(false);
    expect(b.view().total).toBe(0);
  });

  it('survives a JSON round trip, including the seen run ids', () => {
    const b = new SoloBoard();
    b.submit('An', 100, 'r1', 1);
    b.submit('Binh', 90, 'r2', 2);
    const c = new SoloBoard(undefined, JSON.parse(JSON.stringify(b)));
    expect(c.view()).toEqual(b.view());
    expect(c.submit('An', 100, 'r1', 3).improved).toBe(false);
  });
});

describe('the solo board file', () => {
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
