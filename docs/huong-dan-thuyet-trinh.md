# Hướng dẫn: thuyết trình → host game → mời cả lớp chơi

Địa chỉ: **https://game.trandan.id.vn**

| Tab | Đường dẫn | Ai dùng |
|---|---|---|
| Slide | `https://game.trandan.id.vn/` | Laptop chiếu |
| Host game | `https://game.trandan.id.vn/host?key=<HOST_KEY>` | Laptop chiếu |
| Người chơi | `https://game.trandan.id.vn/play` | Điện thoại cả lớp (quét QR) |

Lấy `HOST_KEY`:

```bash
ssh rakkoon69 'grep HOST_KEY ~/hai-ban-tay.config.cjs'
```

## 1. Trước giờ thuyết trình (15 phút trước)

1. Mở thử `https://game.trandan.id.vn/play` trên điện thoại, dùng 4G (không dùng Wi-Fi trường), để chắc web chạy được từ ngoài.
2. Trên laptop chiếu, mở 2 tab:
   - Tab 1: slide `/`.
   - Tab 2: host `/host?key=<HOST_KEY>`. Mã tự biến khỏi thanh địa chỉ sau khi vào.
3. Ở tab host, nếu còn dữ liệu ván test thì bấm **Reset**.
4. Quay về tab slide, bấm `F` để toàn màn hình.

Phím tắt slide: `←` `→` chuyển slide · `N` ghi chú người nói · `F` toàn màn hình.

## 2. Thuyết trình (khoảng 10 phút, 14 slide)

| Slide | Người nói | Việc cần làm |
|---|---|---|
| 1. Bìa | Người 1 | Mời cả lớp **quét QR, nhập tên, bình chọn**. Dặn giữ điện thoại cho phần game. |
| 2–5 | Người 1 | Bàn tay vô hình: thị trường hoàn hảo, Adam Smith, quy luật, ưu thế. |
| 6–9 | Người 2 | Bàn tay hữu hình: khuyết tật thị trường, Keynes, công cụ nhà nước, khi nhà nước làm sai. |
| 10–12 | Người 3 | Trả lời câu hỏi, liên hệ Việt Nam, kết luận. Slide 12 có kết quả bình chọn của lớp. |
| 13. Game | Người 3 | Đọc luật trong 15 giây. |
| 14. QR to | Người 3 | Để yên cho cả lớp quét. Ai đã vào từ slide 1 thì không cần quét lại. |

## 3. Mời cả lớp vào chơi

1. Ở slide 14, nói: "Ai chưa vào thì quét mã này, nhập tên là có quán."
2. Chuyển sang tab host. Màn host cũng có QR và đếm số quán đã mở.
3. Đợi khoảng 30 giây, hoặc khi số quán gần bằng số người trong lớp.

## 4. Host game (khoảng 6 phút, 6 vòng)

Mọi thao tác chỉ là **bấm nút xanh** góc dưới phải, hoặc `→` / PageDown trên bút trình chiếu.
Nút tự khoá khoảng 1 giây sau mỗi lần bấm, nên bấm đúp không bị nhảy vòng.

Mỗi vòng có 3 bước:

| Nút xanh ghi | Màn hình đang hiện | Người nói làm gì |
|---|---|---|
| Mở chọn giá | Giới thiệu vòng (luật mới) | Đọc to tên vòng và luật. |
| Chốt giá ngay | Đếm ngược 20 giây, cả lớp kéo thanh giá | Thúc mọi người chốt. Hết 20 giây tự chốt, không cần bấm. |
| Sang vòng N | Kết quả: quán nào bán được, 🎯 giá tối ưu, bài học | Đọc 1 câu bình luận và câu 💡 bài học. |

Thứ tự 6 vòng và ý cần nhấn:

1. 👻 **Chợ tự do**: cạnh tranh tự kéo giá về mức cân bằng.
2. 👻 **Chợ tự do (lần 2)**: thấy giá vòng trước, mọi người tự chỉnh, giá hội tụ.
3. ✋ **Giá trần 20k**: rẻ cho dân nhưng thiếu hàng, khách xếp hàng mà không mua được.
4. 💸 **Thuế 5k/ly**: lãi giảm, đổi lại nhà nước có ngân sách.
5. 🤢 **Tin đồn**: một nửa khách bỏ về, cần nhà nước kiểm định thông tin.
6. 👻 **Chợ tự do (vòng cuối)**: thông tin minh bạch lại, thị trường tự hồi phục.

Luật phụ cần nhắc ở vòng 1:

- **Ăn bớt nguyên liệu:** mỗi người chỉnh được chi phí nguyên liệu từ 15k xuống tối thiểu 8k. Khách vẫn mua bình thường. Vòng sau quán mất uy tín: cứ bớt 1k thì bán ít đi 1 ly (bớt xuống 8k thì tối đa 3 ly). Vòng thuế chỉ bớt được nguyên liệu, thuế 5k vẫn tính. Vòng cuối khoá 15k.
- **Khách quen:** quán bán lỗ ở một vòng thì vòng sau chắc chắn có 2 khách mua, nếu giá không cao hơn 1.2 lần giá vòng lỗ.
- Trên màn kết quả: 🥄 ăn bớt · 😬 mất uy tín · 💛 có khách quen.

Sau vòng 6, nút xanh ghi **Trao giải 🏆**. Bấm để hiện 4 giải và bảng xếp hạng.

## 5. Kết thúc

1. Đọc tên người thắng các giải.
2. Chốt: "Thị trường tự chạy tốt, nhưng cần nhà nước đúng chỗ, như vòng tin đồn. Can thiệp sai thì gây thiếu hàng, như vòng giá trần."
3. Muốn chơi lại: bấm **Chơi lại**. Người đang online giữ nguyên quán, không cần quét lại.

## Sự cố thường gặp

| Hiện tượng | Xử lý |
|---|---|
| Điện thoại hiện "Mất kết nối, đang nối lại…" | Đợi vài giây. Vẫn vậy thì tải lại trang, quán vẫn còn. |
| Wi-Fi trường không vào được web | Bảo mọi người dùng 4G. |
| Lỡ bấm qua một bước | Không quay lại được. Cứ chơi tiếp, hoặc **Reset** chơi lại từ đầu. |
| Trang trả 502 | Server tắt app. Chạy `ssh rakkoon69 'pm2 resurrect'`. |
