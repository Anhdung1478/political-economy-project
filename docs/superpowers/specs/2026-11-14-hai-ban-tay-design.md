# Web thuyết trình "Hai Bàn Tay" + game "Chợ Trà Sữa Hỗn Loạn" — Design

Ngày: 2026-11-14 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Một web app duy nhất phục vụ buổi thuyết trình môn Kinh tế chính trị Mác–Lênin:

- **10 phút thuyết trình** (3 người, ~3:20 mỗi người) về câu hỏi:
  *Nền kinh tế thị trường hoàn hảo nên được vận hành bởi "bàn tay vô hình" hay "bàn tay hữu hình"?*
  Kết luận của nhóm: **kết hợp cả hai**, liên hệ kinh tế thị trường định hướng XHCN ở Việt Nam.
- **6 phút game** cả lớp chơi bằng điện thoại: mô phỏng chợ trà sữa, luật cực đơn giản, phong cách bựa.

Tiêu chí thành công:
- Chạy mượt trên laptop chiếu + ~30–60 điện thoại cùng lúc, trên server riêng của nhóm.
- Người chơi hiểu luật trong 15 giây.
- UI đẹp, có animation, mọi control (nút, slider, dropdown, input, scrollbar) đều được style riêng — không có style mặc định của trình duyệt.
- Theme tinh nghịch nhưng chuyên nghiệp, không pixel-art.

Ngoài phạm vi (YAGNI): database, nhiều phòng chơi song song, tài khoản, đa ngôn ngữ, lưu lịch sử sau buổi.

## 2. Kiến trúc

TypeScript toàn bộ, **một package, một process Node**:

- **Frontend:** React + Vite + Framer Motion, CSS thuần (CSS variables), font *Be Vietnam Pro*.
- **Backend:** Node + Express (phục vụ file build) + Socket.IO (realtime).
- **Shared:** kiểu dữ liệu và thông số game dùng chung giữa client và server.
- Trạng thái lưu trong RAM; restart server = phòng mới.
- Deploy: `npm ci && npm run build && npm start` (đọc `PORT`, `HOST_KEY`, `PUBLIC_URL` từ env). Kèm `Dockerfile`.

```
shared/        types.ts, config.ts (thông số game, sự kiện từng vòng)
server/        index.ts (express + socket.io)
  game/        market.ts (thuật toán phân bổ khách — hàm thuần)
               engine.ts (state machine của phòng)
               names.ts (sinh tên quán bựa)
               awards.ts (tính danh hiệu)
web/src/
  content/     slides.tsx (toàn bộ nội dung + tên 3 người nói)
  pages/       Presentation.tsx, Host.tsx, Play.tsx
  ui/          Button, Slider, Select, Input, Card, Timer, QR, ...
  styles/      tokens.css, base.css (scrollbar, selection, focus)
```

### Ba màn hình

| Route | Thiết bị | Vai trò |
|---|---|---|
| `/` | Laptop chiếu | Slide thuyết trình |
| `/host?key=…` | Laptop chiếu | Điều khiển + màn chiếu game |
| `/play` | Điện thoại | Tham gia, bình chọn poll, chơi game |

Sự kiện điều khiển game chỉ được server chấp nhận khi kèm đúng `HOST_KEY`.

## 3. Màn thuyết trình (`/`)

- Slide full-screen, chuyển bằng ←/→/Space, nút trên màn hình; transition có animation.
- Góc màn hình: avatar + tên người đang nói, đồng hồ phần hiện tại (mục tiêu 3:20), chuyển cam khi còn 30s, đỏ khi lố.
- Thanh tiến độ tổng 10 phút. Phím `N` bật/tắt panel ghi chú người nói.
- Nội dung, tên người nói, ghi chú nằm hết trong `web/src/content/slides.tsx`. Tên mặc định "Người 1/2/3".

### Nội dung

**Người 1 — Bàn tay vô hình**
1. Mở đầu: câu hỏi lớn + QR + **poll live** "Vô hình hay Hữu hình?" (khán giả vào phòng từ đây).
2. Thị trường "hoàn hảo": 4 điều kiện (nhiều người mua/bán, hàng đồng nhất, thông tin đầy đủ, tự do gia nhập/rút lui) — mô hình lý tưởng.
3. Adam Smith, *Của cải của các dân tộc* (1776): ví dụ người hàng thịt; lợi ích cá nhân → lợi ích xã hội.
4. Cơ chế: quy luật giá trị, cung–cầu, cạnh tranh. Biểu đồ cung–cầu động, điểm cân bằng tự dịch chuyển.
5. Ưu thế của kinh tế thị trường: động lực sáng tạo, phân bổ nguồn lực hiệu quả, thoả mãn nhu cầu.

**Người 2 — Bàn tay hữu hình**
6. Khuyết tật thị trường: khủng hoảng, độc quyền, ngoại ứng/ô nhiễm, hàng hoá công cộng, thông tin bất cân xứng, phân hoá giàu nghèo.
7. Keynes & Đại suy thoái 1929–1933; khủng hoảng 2008.
8. Công cụ nhà nước: pháp luật, chính sách tài khoá, tiền tệ, quy hoạch.
9. Thất bại của nhà nước: thời bao cấp, tem phiếu (trước 1986). Biểu đồ giá trần → thiếu hụt.

**Người 3 — Kết hợp hai bàn tay**
10. Trả lời: thị trường hoàn hảo (giả định) → bàn tay vô hình đủ để **hiệu quả**; nhưng hoàn hảo không tồn tại và hiệu quả ≠ **công bằng** → kết hợp.
11. Việt Nam: Đổi mới 1986, kinh tế thị trường định hướng XHCN; ví dụ quỹ bình ổn giá xăng dầu, giảm VAT 2%, gói hỗ trợ COVID.
12. Kết luận + so sánh kết quả poll đầu giờ.
13. Chuyển sang game: QR (giữ nguyên phòng).

## 4. Game "Chợ Trà Sữa Hỗn Loạn"

### Luật (hiện trên điện thoại và màn chiếu)
> Bạn là chủ quán trà sữa. Mỗi vòng, kéo thanh trượt để chọn **giá bán**. Khách mua ở quán **rẻ nhất trước**, mỗi quán pha tối đa **10 ly**, khách bỏ đi nếu giá vượt túi tiền. **Lãi = (giá − vốn) × số ly bán.** Lãi nhiều nhất sau 4 vòng thắng.

Quyết định duy nhất mỗi vòng: **giá bán** (10k–50k, bước 1k).

### Thông số (trong `shared/config.ts`)
- Vốn mặc định 15k/ly, công suất 10 ly/quán.
- Số khách = 15 × số người chơi. Túi tiền của khách trải đều (tất định, không random) từ 15k đến 60k: `wtp_i = 15 + 45·(i + 0.5)/N`.
  → Với thông số này giá cân bằng lý thuyết ≈ 30k, nên cả bán đắt lẫn bán rẻ đều có lý.
- Thời gian chọn giá 20s/vòng (host có thể chốt sớm).

### 4 vòng
| Vòng | Thẻ sự kiện | Thay đổi | Bài học sau vòng |
|---|---|---|---|
| 1 | 🫥 Chợ tự do | — | Cạnh tranh tự tìm ra mức giá |
| 2 | ✋ Giá trần 20k | giá tối đa 20k | Giá trần → cầu vượt cung → khách xếp hàng không mua được |
| 3 | 💸 Thuế trân châu | vốn 20k/ly; hiện tổng tiền thuế nhà nước thu | Thuế làm tăng chi phí, giảm lãi, tạo ngân sách |
| 4 | 🪱 Tin đồn "nấu từ nước rửa chén" | số khách giảm một nửa | Thông tin bất cân xứng → thị trường thất bại |

### Thuật toán phân bổ khách (`market.ts`, hàm thuần, có test)
1. Nhóm các quán theo giá, xét từ giá thấp đến cao.
2. Khách sắp theo túi tiền giảm dần; khách chỉ mua nếu `wtp ≥ giá`.
3. Trong mỗi nhóm cùng giá: chia khách đủ điều kiện **xoay vòng** cho các quán trong nhóm (thứ tự quán trộn ngẫu nhiên có seed) đến khi hết khách đủ điều kiện hoặc hết công suất.
4. Kết quả: số ly bán và lãi của từng quán, số khách không được phục vụ dù chịu trả giá (thiếu hụt), số ly ế, tổng thuế (nếu có).

Bán dưới vốn được phép (lỗ được) — để bựa.

### Luồng trạng thái phòng (`engine.ts`)
`lobby` (poll + join) → [host bắt đầu] → mỗi vòng: `event` (lật thẻ sự kiện) → `pricing` (20s) → `reveal` (animation kết quả + bài học) → … → `awards` → [host reset] → `lobby`.

- Không gửi giá trong vòng → giữ giá vòng trước (vòng 1: 25k).
- Vào muộn → chơi từ vòng kế tiếp.
- Rớt mạng → điện thoại giữ token trong `localStorage`, kết nối lại vẫn giữ quán và điểm.
- Mỗi lần trạng thái đổi, server phát snapshot đầy đủ (không gửi diff) → client đơn giản, reconnect tự đúng.

### Phần bựa
- Tên quán tự sinh: ghép nickname với mẫu xàm ("Trà Sữa Tâm Linh của X", "X Tea — Uống Là Ghiền, Ghiền Là Nợ", …).
- Màn chiếu: khách hoạt hình chạy về các quán; quán ế hiện chủ ngồi khóc; dòng bình luận kiểu MC bóng đá.
- Nút spam emoji trên điện thoại trong lúc reveal → emoji bay trên màn chiếu (giới hạn ~5 emoji/giây/người).
- Danh hiệu cuối game: 🏆 Đại Gia Trân Châu (lãi nhất), 😇 Mạnh Thường Quân (giá trung bình thấp nhất), 🦈 Tư Bản Hút Máu (giá cao nhất mà vẫn bán được ≥1 ly), 📦 Ông Hoàng Tồn Kho (tổng ly ế nhiều nhất).

### Màn host (`/host`)
QR + số người đã vào, nút: *Bắt đầu game*, *Chốt giá ngay*, *Vòng tiếp*, *Trao giải*, *Reset* (có xác nhận bằng modal tự style). Bảng xếp hạng top 10 có animation đổi chỗ.

### Màn điện thoại (`/play`)
Nhập nickname → nhận tên quán → bình chọn poll → màn chờ ("Đang nghe giảng, cất điện thoại đi 🙏") → mỗi vòng: thẻ sự kiện, slider giá (custom), nút *Chốt giá*; reveal: số ly bán, lãi vòng, hạng hiện tại, nút emoji.

## 5. Thiết kế giao diện
- Tông quán trà sữa: nền kem, chữ mực đậm, nhấn matcha / khoai môn / caramel; bo góc mềm, bóng đổ nhẹ, minh hoạ "bàn tay" bằng SVG.
- Mọi control tự style: button (hover/press/disabled/focus-visible), slider, select/dropdown custom, input, modal, scrollbar, `::selection`.
- Animation: chuyển slide, lật thẻ sự kiện, khách chạy, bảng xếp hạng đổi chỗ, emoji bay. Tôn trọng `prefers-reduced-motion`.
- Responsive: màn chiếu 16:9; điện thoại từ 360px.

## 6. Xử lý lỗi
- Socket.IO tự reconnect; client hiện badge "Mất kết nối…" khi rớt.
- Server validate mọi input: giá trong khoảng của vòng, nickname 1–20 ký tự (trim), sai `HOST_KEY` → bỏ qua; sự kiện sai phase → bỏ qua.
- QR dùng `PUBLIC_URL` nếu có, không thì `window.location.origin`.

## 7. Kiểm thử
- Vitest cho logic thuần: `market.ts` (cùng giá chia đều, giá trần gây thiếu hụt, khách giảm nửa, bán dưới vốn), `engine.ts` (chuyển phase, giữ giá cũ, vào muộn, reconnect), `awards.ts`.
- Test tích hợp Socket.IO: 1 host + vài client giả chơi trọn 4 vòng.
- Kiểm tra thực tế trên trình duyệt (desktop + viewport điện thoại): mọi màn, mọi control đã được style, không lỗi console.
