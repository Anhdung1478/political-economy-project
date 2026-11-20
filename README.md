# Phố Trà Sữa

Game quản lý quán trà sữa trong 5 ngày, minh hoạ câu hỏi "bàn tay vô hình hay bàn tay hữu hình": mỗi ngày người chơi quyết định giá và nguyên liệu, pha chế trong giờ cao điểm và chọn một thẻ tình huống. Thiết kế đầy đủ nằm ở `docs/superpowers/specs/2026-11-19-pho-tra-sua-design.md`.

## Ba chế độ

| Đường dẫn | Ai dùng | Việc |
|---|---|---|
| `/` và `/solo` | Một người, trên điện thoại hoặc máy tính | Chơi một mình; ván lưu trong trình duyệt |
| `/play` | Điện thoại của cả lớp | Vào buổi lớp: nhập tên, bình chọn, chờ host mở chợ, chơi, xem giải |
| `/host?key=<HOST_KEY>` | Laptop của giảng viên | Bảng điều khiển riêng: màn chiếu, bảng theo dõi, nút Mở chợ, Trao giải, Reset |

Hướng dẫn chạy một buổi lớp: [`docs/huong-dan-host.md`](docs/huong-dan-host.md).

## Chạy trên máy

Cần Node 22 trở lên (Dockerfile dùng Node 24).

```bash
npm ci
npm run dev    # server :3000 + Vite :5173, mở http://localhost:5173
```

Vite chuyển `/socket.io` và `/api` sang server ở cổng 3000.

## Build và chạy thật

```bash
npm ci
npm run build   # web vào dist/web, server vào dist/server.js
HOST_KEY=mat-khau-host PUBLIC_URL=https://ten-mien-cua-ban PORT=3000 NODE_ENV=production npm start
```

Docker:

```bash
docker build -t pho-tra-sua .
docker run -d -p 3000:3000 -v pho-tra-sua-data:/app/.data -e HOST_KEY=mat-khau-host -e PUBLIC_URL=https://ten-mien-cua-ban pho-tra-sua
```

`-v pho-tra-sua-data:/app/.data` giữ file buổi lớp (`SESSION_FILE`, mặc định `.data/session.json` trong `/app`) qua lần deploy lại container.

Sau reverse proxy (nginx) phải bật WebSocket (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`). `GET /healthz` trả `ok`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng HTTP |
| `HOST_KEY` | `pho-tra-sua` | Mã vào `/host`. Khi `NODE_ENV=production` mà thiếu biến này, server không chạy |
| `PUBLIC_URL` | origin của trang | Địa chỉ in trong mã QR; đặt khi chạy sau proxy |
| `SESSION_FILE` | `.data/session.json` | File lưu buổi lớp (ghi định kỳ và trước khi xác nhận mỗi lượt vào, bình chọn, ngày chơi) |
| `STATIC_DIR` | `dist/web` cạnh `server.js` | Thư mục web đã build |

Buổi lớp được nạp lại từ `SESSION_FILE` khi server khởi động. File nằm trong hệ thống file của container, nên **sống qua lần khởi động lại tiến trình nhưng mất khi deploy lại container**, trừ khi mount volume vào thư mục của file. File hỏng được đổi tên thành `<file>.corrupt` và server mở buổi mới.

## Bot

Bot giả lập học sinh để thử tải và thử luồng buổi lớp. Cần server đang chạy.

```bash
npm run bots -- join 20    # 20 bot (1 đến 200) vào buổi, bình chọn, chờ chợ mở rồi chơi đủ 5 ngày
npm run bots -- open       # lệnh host: mở chợ
npm run bots -- awards     # lệnh host: trao giải, in giải và top
npm run bots -- reset      # lệnh host: buổi mới
```

Biến: `BOT_URL` (mặc định `http://localhost:3000`), `HOST_KEY` (mặc định `pho-tra-sua`), `BOT_OFFSET` (dịch chỉ số tên bot).

## Kiểm thử và công cụ

```bash
npm test                 # vitest
npm run typecheck        # tsc --noEmit
npm run balance -- [--seeds N] [--from S] [--check ID] [--json]
npm run shoot -- --route "/dev/scene?day=3&seed=7" [--size 390x844] [--dpr 2] [--out .shots/ten]
```

- `balance`: giả lập nhiều chiến lược trên nhiều seed (mặc định 400, khoảng 50 giây) và báo từng điều kiện cân bằng. Thoát 0 khi đạt hết, 1 khi có điều kiện hỏng, 2 khi sai tham số.
- `shoot`: chụp màn hình bằng Chrome không giao diện (puppeteer-core). Đường dẫn Chrome lấy từ `CHROME_PATH`, mặc định là Chrome của Windows. Ảnh vào `.shots/` (không commit). Xem đầu `scripts/shoot.ts` để biết hết cờ (`--frames`, `--every`, `--cpu`, `--ready`, `--full`).

## Đường dẫn dev

Chỉ có khi chạy `npm run dev` (Vite):

| Đường dẫn | Nội dung |
|---|---|
| `/dev/scene` | Con phố (canvas), tham số `day`, `seed` |
| `/dev/characters` | Bảng nhân vật |
| `/dev/game` | Xem từng màn của game ở trạng thái dựng sẵn |
