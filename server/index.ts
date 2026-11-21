import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { Session } from './session';
import { createSavedSoloBoard, soloBoardFilePath } from './soloBoard';
import { createSaver, loadSession, sessionFilePath } from './sessionFile';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
if (!process.env.HOST_KEY && process.env.NODE_ENV === 'production') {
  console.error('❌ Thiếu HOST_KEY. Chạy lại với HOST_KEY=<mã riêng>.');
  process.exit(1);
}
const hostKey = process.env.HOST_KEY ?? 'pho-tra-sua';
if (!process.env.HOST_KEY) console.warn('⚠️  HOST_KEY chưa được đặt — đang dùng mặc định "pho-tra-sua" (chỉ nên dùng khi chạy thử).');

// The session survives a restart (spec §11): loaded from the session file, saved (debounced) after every change, and
// written at once before an accepted join, vote or day is answered (`persistNow`), so a hard kill loses no answer.
const file = sessionFilePath();
const saver = createSaver(file, 500);
const persist = (s: Session) => saver.save(() => s.toJSON());
const loaded = loadSession(file, { persist });
const session = loaded ?? new Session({ persist });
if (!loaded) persist(session); // keep the new session code stable across a restart
console.log(loaded ? `📂 Đã nạp buổi ${session.snapshot().code} từ ${file}` : `🆕 Buổi mới ${session.snapshot().code} (lưu ở ${file})`);

const soloFile = soloBoardFilePath();
const soloSaved = createSavedSoloBoard(soloFile);

const { http } = createApp({
  hostKey,
  session,
  soloBoard: soloSaved.board,
  soloPersistNow: soloSaved.commit,
  trustProxy: process.env.TRUST_PROXY === '1',
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, 'web'),
  publicUrl: process.env.PUBLIC_URL || undefined,
  persistNow: () => saver.flush(),
});

http.listen(port, () => {
  console.log(`🧋 Phố Trà Sữa đang chạy ở http://localhost:${port}`);
  console.log(`   Màn host: http://localhost:${port}/host`);
});

// Flush the pending save, then exit. A hung write cannot make the process unkillable: a second signal, or 5 s,
// exits at once with code 1.
let stopping = false;
const shutdown = () => {
  if (stopping) process.exit(1);
  stopping = true;
  setTimeout(() => process.exit(1), 5000).unref();
  void Promise.all([saver.flush(), soloSaved.flush()]).then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
