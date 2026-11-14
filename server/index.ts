import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const hostKey = process.env.HOST_KEY ?? 'hai-ban-tay';
if (!process.env.HOST_KEY) console.warn('⚠️  HOST_KEY chưa được đặt — đang dùng mặc định "hai-ban-tay".');

const { http } = createApp({
  hostKey,
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, 'web'),
  publicUrl: process.env.PUBLIC_URL || undefined,
});

http.listen(port, () => {
  console.log(`🧋 Hai Bàn Tay đang chạy ở http://localhost:${port}`);
  console.log(`   Màn host: http://localhost:${port}/host?key=${hostKey}`);
});
