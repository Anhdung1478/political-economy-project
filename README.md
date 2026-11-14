# Hai Bàn Tay 🥤

Web thuyết trình môn Kinh tế chính trị Mác – Lênin:

> Nền kinh tế thị trường hoàn hảo nên được vận hành bởi **"bàn tay vô hình"** hay **"bàn tay hữu hình"**?

- **10 phút thuyết trình** (3 người, 13 slide) với poll trực tiếp và biểu đồ cung – cầu động.
- **6 phút game "Chợ Trà Sữa Hỗn Loạn"**: cả lớp quét QR, mỗi người làm chủ một quán trà sữa, mỗi vòng chỉ chọn giá bán. 5 vòng: chợ tự do (2 lần) → giá trần → thuế → tin đồn.

## Ba màn hình

| Đường dẫn | Ai mở | Dùng để |
|---|---|---|
| `/` | Laptop chiếu | Slide thuyết trình |
| `/host?key=<HOST_KEY>` | Laptop chiếu | Điều khiển và chiếu game |
| `/play` | Điện thoại khán giả | Bình chọn và chơi game (quét QR trên slide) |

Phím tắt ở màn slide: `←` `→` chuyển slide · `N` ghi chú người nói · `F` toàn màn hình.
Ở màn host, `→` / PageDown (bút trình chiếu) cũng bấm được nút chính.

## Chạy trên máy

Cần Node 22+.

```bash
npm ci
npm run dev        # server :3000 + Vite :5173 → mở http://localhost:5173
```

## Deploy lên server

```bash
npm ci
npm run build
HOST_KEY=mat-khau-host PUBLIC_URL=https://ten-mien-cua-ban PORT=3000 npm start
```

Hoặc dùng Docker:

```bash
docker build -t hai-ban-tay .
docker run -d -p 3000:3000 -e HOST_KEY=mat-khau-host -e PUBLIC_URL=https://ten-mien-cua-ban hai-ban-tay
```

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng HTTP |
| `HOST_KEY` | `hai-ban-tay` | Mã để vào `/host` (**nhớ đổi**) |
| `PUBLIC_URL` | origin của trang | Địa chỉ in trong QR (đặt khi chạy sau reverse proxy) |

Nếu đặt sau nginx, nhớ bật WebSocket (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).
Trạng thái game nằm trong RAM, restart server là ván mới.

## Kịch bản ngày thuyết trình

1. Trước giờ: deploy với `HOST_KEY` và `PUBLIC_URL` đúng tên miền; mở thử `/` trên laptop chiếu.
2. Mở sẵn 2 tab: tab 1 là `/` (slide), tab 2 là `/host?key=<HOST_KEY>` (mã tự biến khỏi thanh địa chỉ sau khi vào).
3. Slide 1: cả lớp quét QR, nhập tên, bình chọn. Giữ điện thoại lại cho phần game.
4. Hết slide 13: chuyển sang tab host, bấm nút xanh (hoặc `→` trên bút trình chiếu) để đi qua từng bước. Nút tự khoá ~1 giây sau mỗi bước nên bấm đúp không bị trôi vòng.
5. Muốn chơi lại: **Reset**. Quán của người đã thoát sẽ bị dọn.

Khi `NODE_ENV=production` (mặc định trong Docker), server từ chối khởi động nếu thiếu `HOST_KEY`.

## Sửa nội dung

- Tên 3 người nói: `web/src/content/speakers.ts`
- Nội dung slide và ghi chú: `web/src/content/slides.tsx`
- Luật game và các vòng: `shared/config.ts`

## Tổng duyệt với bot

```bash
HOST_KEY=... node scripts/bots.mjs auto 15   # 15 bot chơi trọn một ván, host tự bấm mỗi 3 giây
node scripts/bots.mjs join 10                # thêm 10 bot vào chợ
```

## Kiểm thử

```bash
npm test          # logic chợ, engine, server Socket.IO
npm run typecheck
```

Ảnh tư liệu: Wikimedia Commons, phạm vi công cộng (public domain).
