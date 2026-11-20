# Hướng dẫn host một buổi lớp

Địa chỉ triển khai trước đây: **https://game.trandan.id.vn** (đổi nếu bạn deploy chỗ khác).

| Tab | Đường dẫn | Ai dùng |
|---|---|---|
| Host | `/host?key=<HOST_KEY>` | Laptop chiếu của giảng viên |
| Người chơi | `/play` | Điện thoại cả lớp (quét QR) |

Lấy `HOST_KEY` từ file cấu hình pm2 trên máy chủ (ssh alias `rakkoon69`). File này nằm ngoài repo nên vẫn giữ tên từ lần deploy đầu; nếu đổi tên file thì sửa lệnh dưới đây theo:

```bash
ssh rakkoon69 'grep HOST_KEY ~/hai-ban-tay.config.cjs'
```

## 1. Trước giờ học (15 phút)

1. Mở `/play` trên điện thoại bằng **4G** (không dùng Wi-Fi trường) để chắc web vào được từ ngoài.
2. Trên laptop chiếu, mở `/host?key=<HOST_KEY>`. Mã tự biến khỏi thanh địa chỉ sau khi vào.
3. Nếu còn dữ liệu ván thử, bấm **Reset** rồi xác nhận. Buổi mới có mã mới.
4. Màn host có hai chế độ ở góc trên: **Màn chiếu** (cho cả lớp xem) và **Bảng theo dõi** (riêng cho host).

## 2. Mời cả lớp

1. Để **Màn chiếu** lên máy chiếu: có mã QR và số người đã vào.
2. Học sinh quét QR, nhập tên quán và bình chọn "bàn tay vô hình hay hữu hình" (đổi được đến khi chợ mở).
3. Đợi số người vào gần bằng sĩ số. Ai vào trễ vẫn vào được cho đến khi trao giải.

## 3. Mở chợ

Bấm **Mở chợ**. Mỗi người tự chơi 5 ngày trên điện thoại của mình, không chờ nhau. Nút chỉ bấm được khi buổi đang ở phòng chờ.

## 4. Theo dõi

Chuyển sang **Bảng theo dõi**: tổng quan (số người, giá trung bình của lớp, các lựa chọn, bình chọn trước và sau) và danh sách thành viên với trạng thái kết nối. Lúc này hãy kể chuyện về những gì thấy trên bảng.

## 5. Trao giải

Khi phần lớn đã chơi xong, bấm **Trao giải** và xác nhận. Giải và top 5 được chốt theo những ngày đã gửi về lúc đó; ai chưa xong vẫn chơi tiếp nhưng giải không đổi. Nút chỉ bấm được khi chợ đang mở. Đọc tên người thắng, rồi chốt: thị trường tự chạy tốt, nhưng cần nhà nước đúng chỗ.

## 6. Reset

Bấm **Reset** để làm buổi mới: seed và mã buổi mới, kết quả, bình chọn và giải bị xoá. Người đang kết nối giữ tên, không cần quét lại.

## Lưu trạng thái

Buổi lớp được lưu vào `SESSION_FILE` (mặc định `.data/session.json`). File **sống qua lần khởi động lại tiến trình** (pm2 restart, server tự khởi động lại) nên học sinh vào lại được. File **không sống qua lần deploy lại container**, vì nằm trong hệ thống file của container; muốn giữ thì mount volume. Đừng deploy giữa buổi học.

## Sự cố thường gặp

| Hiện tượng | Xử lý |
|---|---|
| Điện thoại hiện mất kết nối | Đợi vài giây; vẫn vậy thì tải lại trang, quán và tiến độ vẫn còn. Điện thoại tự gửi lại ngày đã chơi khi có mạng. |
| Wi-Fi trường không vào được web | Bảo mọi người dùng 4G. |
| Nút Mở chợ, Trao giải bị mờ | Mở chợ chỉ ở phòng chờ, Trao giải chỉ khi chợ đang mở. Nếu cả ba nút mờ, host đang mất kết nối: chờ nối lại. |
| Bấm nhầm Trao giải | Không hoàn lại được. Reset để làm lại buổi. |
| Học sinh quét QR vào trang khác hoặc QR sai tên miền | Server cần `PUBLIC_URL` đúng tên miền; đặt lại và khởi động lại tiến trình. |
| Trang trả 502 | Tiến trình tắt. Theo cách deploy cũ: `ssh rakkoon69 'pm2 resurrect'`. Buổi lớp được nạp lại từ file. |
| Sau deploy lại, buổi mới trống | File buổi mất theo container cũ. Bảo học sinh tải lại trang để vào buổi mới; kết quả cũ không lấy lại được. |
| Quên `HOST_KEY` | Lấy lại bằng lệnh ssh ở đầu tài liệu, hoặc xem biến môi trường của container. |
