# Game "Phố Trà Sữa" — Design

Ngày: 2026-11-20 · Trạng thái: đã duyệt · Thay thế: `2026-11-14-hai-ban-tay-design.md`

## 1. Mục tiêu

Thay game "Chợ Trà Sữa Hỗn Loạn" bằng một game **single-player** minh hoạ câu hỏi "bàn tay vô hình hay bàn tay hữu hình". Web chỉ còn game; slide thuyết trình chuyển sang nơi khác.

Hai hạn chế của game cũ cần giải quyết:

1. **Quá ít tương tác:** mỗi vòng chỉ kéo 1–2 slider. Game mới có ba kiểu tương tác mỗi ngày: quyết định quản lý, pha chế thời gian thực, thẻ tình huống có nhân vật.
2. **Ít người thì lệch:** kết quả phụ thuộc số người chơi. Game mới cho mỗi người một ván riêng đấu với 6 quán AI, nên chơi được từ 1 người.

Tiêu chí thành công:

- Một người mở link là chơi được trọn ván, không cần host, không cần người khác.
- Chạy trên điện thoại (dọc và ngang) và máy tính, bằng cảm ứng lẫn chuột.
- Trong lớp, mọi người chơi **cùng một seed** nên điểm so sánh được.
- Người chơi tự rút ra bài học từ trải nghiệm, không cần người thuyết trình dừng lại giảng.
- **Hình ảnh và chuyển động là yêu cầu hàng đầu, không phải phần trang trí.** Con phố phải sống: khách đi bộ, nhìn giá, chọn quán, nói ra lý do. Mục 9 liệt kê các chuyển động bắt buộc.
- Một ván dài khoảng 12 phút.

Ngoài phạm vi: người chơi ảnh hưởng lẫn nhau, chống gian lận, tài khoản, nhiều phòng song song, âm thanh, đa ngôn ngữ.

## 2. Đường dẫn và chế độ

| Đường dẫn | Chế độ | Mô tả |
|---|---|---|
| `/` và `/solo` | Solo | Chơi ngay, seed ngẫu nhiên mỗi ván, không kết nối server. Lưu kỷ lục cá nhân trên máy. |
| `/play` | Lớp học | Nhập tên, bình chọn, chờ host mở chợ, chơi bằng seed của buổi, kết quả gửi về host. |
| `/host` | Host | Cần `HOST_KEY`. Gồm màn chiếu (QR, giải) và bảng theo dõi riêng tư. |

Luồng lớp học:

1. Mọi người quét QR vào `/play`, nhập tên, bình chọn "vô hình hay hữu hình", rồi thấy màn chờ.
2. Host bấm **Mở chợ**. Ai cũng bắt đầu ván và tự chơi theo tốc độ riêng. Người vào muộn bắt đầu ngay.
3. Host theo dõi bảng live.
4. Host bấm **Trao giải**. Điện thoại hiện hạng và giải. Ai chưa xong vẫn chơi tiếp được, nhưng giải đã chốt.
5. **Reset** tạo seed và mã buổi mới, xoá kết quả và bình chọn, giữ tên những người đang kết nối.

Chỉ ván đầu tiên trong buổi được tính. Bấm "chơi lại" sau khi xong sẽ chuyển sang `/solo`.

## 3. Một ván

5 ngày. Mỗi ngày gồm 4 nhịp, khoảng 2,5 phút:

| Nhịp | Thời gian | Nội dung |
|---|---|---|
| ☀️ Sáng | không giới hạn, mục tiêu dưới 30s | Bản tin, đặt giá, nhập hàng, chọn loại trà, mua nâng cấp |
| 🔥 Trưa | 90s cố định | Pha chế và giao hàng thời gian thực, cảnh phố sống |
| 🃏 Chiều | 1–2 thẻ | Nhân vật ghé quán, chọn 1 trong 2 |
| 🌙 Tối | bấm tiếp | Báo cáo ngày và thẻ bài học |

Sau ngày 5 là màn kết.

**Điểm = tổng lãi + giá trị thương hiệu.**

- Tổng lãi = tiền cuối ván − 300k vốn ban đầu.
- Giá trị thương hiệu = uy tín cuối ván × 12k. Nhờ khoản này, uy tín còn ý nghĩa tới ngày cuối.

Ván kết thúc sớm nếu uy tín về 0 (mục 4).

### Lịch 5 ngày

| Ngày | Chủ đề | Luật thay đổi | Thẻ cốt truyện buổi chiều | Bài học (thẻ tối) |
|---|---|---|---|---|
| 1 | 👻 Khai trương | Chợ tự do, 5 quán AI | Chuỗi Tập Đoàn (mai khai trương) rủ cả phố cùng bán 36k | Không ai ra lệnh, các quán nhìn nhau chỉnh giá và giá tự tìm về một mức. |
| 2 | 👻 Phố đông lên | Chuỗi Tập Đoàn mở. Cartel có hiệu lực nếu bạn đồng ý. | Nhà cung cấp mời topping "giá sốc, khỏi hỏi nguồn gốc" | Lãi cao hút người mới vào, khách bị chia, giá bị kéo xuống. Bắt tay nâng giá là khuyết tật thị trường, nhà nước phải phạt. |
| 3 | ✋ Giá trần 20k | Không quán nào bán ly M quá 20k | Khách dúi thêm tiền để mua vượt trần | Giá trần thấp hơn giá cân bằng: người mua tăng, người bán rút lui, khách xếp hàng mà không mua được, sinh ra chợ đen. |
| 4 | ✋ Thuế 5k/ly | Mỗi ly bán ra nộp 5k để xây trạm xe buýt | (a) Khai đủ thuế hay khai gian? (b) Tin đồn bắt đầu lan: tự trả tiền kiểm định hay chờ nhà nước | Thuế làm lãi giảm nhưng xây được thứ cả phố cùng hưởng. Ai trốn thuế vẫn hưởng: bài toán người ăn theo. |
| 5 | 🤢 Tin đồn nước rửa chén | Nửa đầu trưa khách chỉ còn 50%. Giây 45 nhà nước công bố kiểm định, khách quay lại. Trạm xe buýt mở, +25% khách. | Phóng viên hỏi: "Bàn tay nào cứu phố này?" | Người mua không biết quán nào sạch nên tẩy chay cả phố. Thị trường không tự sửa được thông tin; nhà nước kiểm định và công bố thì khách quay lại. |

Ngày 1–3 có thêm 1 thẻ phụ rút theo seed. Ngày 4 có 2 thẻ cốt truyện, ngày 5 chỉ có thẻ phóng viên.

Thẻ bài học hiện số liệu thật của ván (mục 8) và có biến thể theo lựa chọn của người chơi. Ví dụ thẻ ngày 2 có ba bản: từ chối cartel, giữ lời, phá thoả thuận.

## 4. Mô hình kinh tế

Mọi con số trong mục này nằm trong `shared/sim/config.ts` và **đã được chỉnh bằng bộ giả lập** (mục 14). Giá trị khởi điểm của những số đã đổi nằm trong lịch sử git.

### Nguyên tắc: hàng khan hơn khách

Số khách của phố là cố định mỗi ngày, không phụ thuộc số quán. Tổng sức pha của các quán nhỏ hơn số khách đủ tiền ở giá thấp. Ba hệ quả mà game cần:

- Quán mới mở chia khách của mọi người, giá cân bằng tụt (ngày 2).
- Quán đóng cửa nhường khách cho quán còn lại, giá cân bằng tăng.
- Giá trần dưới giá cân bằng gây thiếu hụt thật (ngày 3).

Với 130 khách, túi tiền trải đều 15–60k. Cột cuối là số đo của bộ giả lập trên lối chơi hợp lý (trung bình 400 seed):

| Tình huống | Tổng sức pha (chưa nâng cấp) | Giá đóng cửa trung bình của phố |
|---|---|---|
| Ngày 1: bạn + 5 quán AI | 78 ly | khoảng 33k |
| Ngày 2: thêm Chuỗi Tập Đoàn | 96 ly | khoảng 29k |
| Ngày 3: giá trần 20k, 2 quán nghỉ bán | 72 ly cho khoảng 115 người muốn mua | 20k, khoảng 31% người đủ tiền về tay không |

### Giá và chi phí của người chơi

- Người chơi đặt **giá ly M không topping**, 10–50k, bước 1k.
- Ly S rẻ hơn 5k, ly L đắt hơn 5k, mỗi phần topping thêm 5k. Phụ thu giống nhau ở mọi quán, nên các quán chỉ cạnh tranh trên một con số.
- Size chỉ đổi lượng trà: S 250 ml, M 350 ml, L 500 ml. Topping tính theo phần, không phụ thuộc size.
- Trà mua theo ml (bước 250 ml), giá theo loại:

| Loại trà | Giá mỗi 100 ml | Uy tín (tính vào buổi tối) |
|---|---|---|
| 🥄 Ăn bớt | 2k | −10 |
| Chuẩn | 3k | 0 |
| 💎 Cao cấp | 4k | +6 |

- Topping: trân châu, thạch, pudding. Mỗi phần giá vốn 2k. Đá miễn phí.
- Cuối ngày trà và topping thừa đều bỏ.
- Vốn ban đầu 300k. Được mua chịu tới khi tiền còn −150k. Tiền phạt vẫn bị trừ dù tiền đã âm.

### Nâng cấp

Mỗi sáng mua tối đa 1 món. Mỗi món chỉ mua được một lần, dùng tới hết ván.

| Nâng cấp | Giá | Tác dụng |
|---|---|---|
| Nhân viên | 150k | Một người phụ pha song song: cứ 9 giây tự phục vụ đúng món cho khách đầu hàng, dùng nguyên liệu của quán |
| Máy pha | 80k | Thời gian rót trà giảm một nửa |
| Băng rôn | 100k | +10 uy tín ngay khi mua |

Sức pha mỗi trưa: khoảng 18 ly khi không nâng cấp, khoảng 21 ly với máy pha, thêm khoảng 10 ly với nhân viên.

### Uy tín

Thang 0–100, khởi đầu 50. Uy tín tác động theo bốn cách:

- **Cộng hoặc trừ điểm hấp dẫn** của quán trong mắt từng khách (công thức ở phần Khách).
- **Thu hẹp số khách chịu ghé:** mỗi khách có một ngưỡng tin tưởng từ seed, trải đều 0–50. Khách chỉ xét những quán có uy tín từ ngưỡng của mình trở lên. Uy tín từ 50 thì mọi khách đều xét, uy tín 25 thì còn một nửa.
- **Giá trị thương hiệu** trong điểm cuối: mỗi điểm uy tín đáng 12k.
- **Uy tín về 0 là thua:** ván kết thúc ngay sau báo cáo tối với màn kết "Mất hết lòng tin". Điều này áp dụng cả ở tối ngày 5.

Uy tín thay đổi ở hai thời điểm, luôn kẹp trong 0–100:

| Thời điểm | Các khoản |
|---|---|
| **Sáng** (trước khi nhập hàng) | Hậu quả trễ của thẻ; băng rôn (ngay lúc mua) |
| **Tối** (sau giờ bán) | Loại trà; giao sai −2 mỗi ly; khách chờ quá lâu bỏ về −1 mỗi khách; tăng giá giữa trưa quá 20% −3; **phục vụ sạch +3** (cả ngày không giao sai và không ai bỏ về vì chờ); hậu quả ngay của thẻ chọn chiều hôm đó |

Báo cáo tối liệt kê từng khoản.

**Ngày ăn bớt** là ngày người chơi dùng trà loại ăn bớt hoặc đang dùng topping giá sốc (thẻ ngày 2). Mỗi ngày đếm một lần.

### Khách

- **Số khách mỗi ngày:** 130 × hệ số ngày. Ngày 5 có trạm xe buýt nên ×1,25.
- Mỗi khách sinh từ seed, gồm:
  - túi tiền cho một ly M: 15–60k, trải đều
  - ngưỡng tin tưởng: 0–50, trải đều
  - độ đa nghi: 0–1
  - size: S 25%, M 50%, L 25%, túi tiền cao nghiêng về L
  - topping: 1–3 loại khác nhau (50% / 35% / 15%), mỗi loại 1 phần, trân châu được gọi nhiều nhất
  - thời điểm đến: trong 75 giây đầu của trưa
- Khi đến, khách chấm điểm từng quán đang mở, còn phục vụ được đơn của mình và có uy tín từ ngưỡng tin tưởng trở lên:

  > điểm = túi tiền − giá ly M + (uy tín − 50) × 0,2k − 2k × số người đang xếp hàng

  Khách vào quán điểm cao nhất. Không quán nào có điểm dương thì khách rời phố.
- Khách không vào hàng đã có từ 5 người trở lên; lý do ghi là đông quá.
- Khách chờ tối đa 25 giây. Hết kiên nhẫn thì rời hàng và **chọn lại một lần**: chấm các quán chưa ghé, vào quán tốt nhất còn điểm dương với 25 giây kiên nhẫn mới, hoặc rời phố. Mỗi khách ghé tối đa 2 quán.
- Với mỗi quyết định, sim ghi lại **lý do** khách không chọn từng quán (đắt quá, đông quá, uy tín thấp, hết món, quán khác tốt hơn). Cảnh phố dùng lý do này cho bong bóng lời nói (mục 9).

### 6 quán AI

Quán AI là **mô hình giản lược**, khác quán người chơi ở các điểm sau:

- Nhập hàng theo ly nguyên, luôn nhập đủ sức pha. Phục vụ được mọi đơn cho tới khi hết ly.
- Pha tự động theo nhịp cố định, không giao sai.
- Sổ sách chỉ tính theo giá ly M: lãi ngày = (giá − giá vốn − thuế) × số ly bán − giá vốn × số ly thừa − 80k tiền mặt bằng.
- Uy tín cố định cả ván, trừ khoản trừ tạm của ngày tin đồn.
- Hàng khách, kiên nhẫn 25 giây và cách khách chấm điểm thì giống hệt quán người chơi.

| Quán | Có mặt | Giá ngày đầu | Giá vốn | Uy tín | Sức pha | Luật giá mỗi sáng |
|---|---|---|---|---|---|---|
| 🧋 Quán Bà Tư | ngày 1 | 36k | 13k | 50 | 12 ly, 7s/ly | Giá đóng cửa hôm qua của mình, nhích 1k về phía trung bình các quán khác |
| 💸 Chuỗi GiáRẻ | ngày 1 | 30k | 10k | 35 | 12 ly, 7s/ly | Giá đóng cửa thấp nhất của các quán khác − 3k |
| 🐢 Quán Ông Cố Chấp | ngày 1 | 25k | 14k | 55 | 12 ly, 7s/ly | Luôn 25k |
| 📈 Anh Lướt Sóng | ngày 1 | 40k | 13k | 50 | 12 ly, 7s/ly | Chép giá đóng cửa của quán kiếm nhiều nhất hôm qua |
| 🎲 Quán Sinh Viên Khởi Nghiệp | ngày 1 | 40k | 15k | 45 | 12 ly, 7s/ly | Mỗi sáng đổi 3k theo hướng đang thử (ban đầu là giảm); đảo hướng nếu hôm qua kiếm ít hơn hôm kia |
| 🏢 Chuỗi Tập Đoàn | ngày 2 | trung bình phố − 4k | 11k | 60 | 18 ly, 5s/ly | Trung bình giá đóng cửa của các quán khác − 4k |

Định nghĩa dùng chung:

- **Giá đóng cửa** là giá của quán lúc hết trưa. Với người chơi, đó là giá sau khi đổi nếu có đổi. "Các quán khác" luôn gồm cả người chơi.
- **Kiếm nhiều nhất** so trên cùng một thước đo cho mọi quán, kể cả người chơi: (giá đóng cửa − 13k) × số ly bán.
- **Giá tự do gần nhất:** sáng ngày 4, các luật dùng giá đóng cửa của ngày 2, không dùng giá bị trần của ngày 3.
- **Thuế:** ngày 4 mọi quán AI cộng thêm 3k vào giá sau khi áp luật, tức chuyển một phần thuế sang khách.
- **Kẹp giá:** mọi giá của quán AI nằm trong khoảng từ giá vốn + thuế + 1k đến mức thấp hơn giữa 50k và giá trần.

**Chỉnh giá giữa trưa.** Ở giây 30 và giây 60, mỗi quán AI trừ Ông Cố Chấp và Chuỗi GiáRẻ xét lại giá:

- +2k nếu hàng đang có từ 4 người, hoặc đã bán được 33% hàng (giây 30) hay 66% hàng (giây 60), tức là bán kịp hết công suất từ đầu trưa.
- −2k nếu không ai xếp hàng và mới bán dưới 33% hàng (giây 30) hay dưới 66% hàng (giây 60).

Bảng giá trên phố đổi ngay, nên người chơi thấy giá hội tụ trong lúc bán. Khách đang xếp hàng ở quán đổi giá chấm lại điểm theo luật ở mục 6.

**Nghỉ bán.** Quán AI nghỉ cả ngày nếu giá cao nhất được phép thấp hơn giá vốn của nó + 7k. Với giá trần 20k, Ông Cố Chấp và Sinh Viên Khởi Nghiệp nghỉ bán. Ngày nghỉ vẫn mất tiền mặt bằng.

**Rút lui.** Quán AI lỗ 2 ngày liền thì đóng cửa hẳn từ sáng hôm sau. Luật này cũng chạy sau ngày 5 để màn kết kể quán nào không trụ được.

### Chính sách

- **Giá trần (ngày 3):** giá ly M tối đa 20k, kể cả khi đổi giá giữa trưa. Báo cáo tối đếm "khách về tay không": người có túi tiền từ 20k trở lên nhưng rời phố mà không mua được.
- **Thuế (ngày 4):** 5k mỗi ly, trừ ngay khi bán, chỉ trong ngày 4. Cảnh phố có công trường trạm xe buýt. Báo cáo tối hiện "quỹ phường" gồm thuế của cả phố.
- **Trạm xe buýt (ngày 5):** +25% khách. Bản tin sáng và báo cáo tối ngày 5 ghi rõ "không có trạm: X khách, có trạm: Y khách".
- **Tin đồn (ngày 5):**
  - Từ đầu trưa tới giây 45, khách đến với nửa nhịp bình thường. Quán chưa kiểm định bị trừ tạm 10 điểm uy tín, thêm 5 điểm cho mỗi ngày đã ăn bớt.
  - Giây 45, xe loa phường công bố kết quả kiểm định của nhà nước. Quán có dưới 2 ngày ăn bớt được gỡ khoản trừ và gắn huy hiệu "Đã kiểm định". Quán từ 2 ngày ăn bớt trở lên bị nêu tên và giữ khoản trừ tới hết ngày. Khách đến lại với nhịp đầy đủ.
  - Khoản trừ tạm chỉ dùng để tính khách trong ngày 5. Nó không ghi vào uy tín của quán và không làm thua ván.
  - Chuỗi Tập Đoàn và Ông Cố Chấp đã tự kiểm định từ trước. Chuỗi GiáRẻ tính như đã ăn bớt 4 ngày.

## 5. Buổi sáng

Màn sáng gồm:

- **Bản tin:** chủ đề và luật của hôm nay; hậu quả trễ của thẻ nếu có; bảng giá đóng cửa hôm qua của cả phố kèm quán nào bán hết, quán nào ế, quán nào mới mở hay vừa đóng cửa.
- **Giá ly M.**
- **Loại trà** và **số ml trà.**
- **Số phần của từng topping.**
- **Nâng cấp** (tuỳ chọn).
- Tổng tiền nhập hàng so với tiền đang có, và dòng "sức pha hôm nay: khoảng N ly".
- Dòng gợi ý: "Hôm qua bạn bán 14 ly, dùng 5.100 ml trà, 11 trân châu, 6 thạch, 6 pudding."
- Ba nút nhập nhanh: ít (~10 ly), vừa (~15 ly), nhiều (bằng sức pha hôm nay). Nút điền sẵn trà và topping theo tỉ lệ khách thường gọi, người chơi chỉnh tiếp được.

Bấm **Mở cửa** thì trừ tiền và sang trưa. Ngày 1 điền sẵn mức "vừa" và giá 30k. Khi tiền đã chạm −150k, vẫn mở cửa được với hàng bằng 0.

## 6. Buổi trưa (90 giây)

### Hai lớp giao diện

- **Cảnh phố** là lớp nền, chiếm trọn màn hình (mục 9).
- **Bảng pha chế** là lớp phủ, mở và đóng được. Khi mở nó che một phần phố. Khi đóng, phố hiện đầy đủ, còn lại một thanh nhỏ ghi số khách đang chờ và nút mở bảng.
- Đồng hồ chạy bất kể bảng đang mở hay đóng. Người chơi tự cân giữa quan sát phố và pha chế.

### Pha một ly

Các nút sáng lên theo đúng thứ tự:

| Bước | Thao tác | Thời gian animation |
|---|---|---|
| 1. Chọn size | Chạm S / M / L, ly đặt xuống quầy | 0,4s |
| 2. Đổ đá | Chạm một lần | 0,8s |
| 3. Đổ trà | Chạm một lần, trà tự rót đến vạch của size | S 1,2s · M 1,6s · L 2,0s |
| 4. Topping | Chạm mỗi loại một lần, từ 0 đến 3 loại | 0,6s mỗi loại |
| 5. Giao | Kéo ly thả vào khách, hoặc chạm ly rồi chạm khách | 0,4s |

- Animation chiếm khoảng 4,2 giây của một ly trung bình. Cả ly mất khoảng 5 giây.
- **Bấm trước được:** trong lúc một animation chạy, người chơi bấm sẵn tối đa 3 bước tiếp theo, chúng chạy nối đuôi. Vì vậy tay nhanh gần như không pha được nhiều hơn tay chậm.
- Chỉ giao được khi ly đã có trà và không còn animation nào đang chạy.
- Mỗi lúc người chơi pha 1 ly. Nhân viên, nếu có, pha song song ở quầy bên.
- Mọi thời lượng là bội số của 100 ms.

### Quầy

- Bảng pha chế hiện 4 khách đầu hàng, mỗi người có bong bóng ghi size, topping và thanh kiên nhẫn. Số khách còn lại hiện thành con số.
- Giao được cho bất kỳ ai trong 4 khách, nên người chơi tự chọn phục vụ ai trước.
- **Giao đúng** (đúng size và đúng tập topping): nhận đủ tiền đơn.
- **Giao sai** (sai size hoặc sai tập topping) bị phạt hai lần:
  - **Tiền:** khách chỉ trả 70% giá của ly rẻ hơn giữa đơn đã gọi và ly thực nhận, làm tròn xuống 1k. Phần topping thừa không được trả thêm. Ví dụ khách gọi ly 41k, nhận ly đáng 31k, quán thu 21k.
  - **Uy tín:** quán bị ghi 1 ly giao sai, −2 uy tín vào buổi tối.
- **Thùng rác:** bỏ ly đang pha, mất phần nguyên liệu đã dùng.
- **Còn hàng cho một đơn** nghĩa là trà còn lại (không tính phần đã rót vào ly đang pha) đủ cho size của đơn và mỗi topping của đơn còn ít nhất 1 phần. Khách mới chỉ xét quán người chơi khi còn hàng cho đơn của họ.
- Mỗi khi kho thay đổi, khách đang xếp hàng mà quán hết hàng cho đơn của họ sẽ rời hàng và chọn lại quán, không trừ uy tín.
- Trà dưới 250 ml thì quán treo biển hết hàng.
- **Đóng cửa sớm:** nút kết thúc trưa ngay. Phần còn lại của phố được mô phỏng tức thì. Dùng khi hết hàng.
- **Hết 90 giây:** khách còn trong hàng ra về, không trừ uy tín. Ly đang pha dở bị bỏ.

### Đổi giá giữa trưa

Người chơi được đổi giá 1 lần mỗi trưa. Đồng hồ vẫn chạy trong lúc chọn. Mức thay đổi tính so với giá buổi sáng, bằng số nguyên: 25k lên 30k là đúng 20%, chưa vượt.

- Sau khi đổi, mỗi khách trong hàng chấm lại điểm với giá mới. Ai có điểm từ 0 trở xuống thì rời hàng và chọn lại quán, không trừ uy tín.
- **Tăng quá 20%:** bị ghi "chặt chém", −3 uy tín vào buổi tối.
- **Giảm quá 20%:** khách bỏ đi nếu độ đa nghi > 1 − (mức giảm − 20%) × 2,5. Giảm 60% thì cả hàng bỏ đi. Khách mới đến sau đó cũng áp phép thử này trước khi xét quán.

Quán AI đổi giá giữa trưa cũng theo luật chấm lại điểm. Chúng chỉ đổi 2k mỗi lần nên không bao giờ chạm ngưỡng 20%.

### Kỹ thuật

- Engine chạy theo nhịp 100 ms. Trạng thái trưa là dữ liệu thuần, `step(state, actions)` là hàm thuần và phát ra danh sách sự kiện cho cảnh phố.
- Chuyển tab hoặc khoá máy thì đồng hồ dừng.
- Ngày 1 có một ly thử trước khi đồng hồ chạy: giao diện tô sáng nút cần bấm tiếp theo. Ly thử không tính tiền và không dùng nguyên liệu.

## 7. Thẻ nhân vật

Mỗi thẻ có nhân vật, 1–2 câu thoại và 2 lựa chọn, chọn bằng vuốt hoặc bấm. Thẻ cho thấy **chỉ số nào bị ảnh hưởng** (💰 tiền, ⭐ uy tín, 🧋 hàng, 🏛️ pháp luật) nhưng không cho thấy con số.

### Thẻ cốt truyện

| Ngày | Thẻ | Lựa chọn A | Lựa chọn B |
|---|---|---|---|
| 1 | **Cartel.** Đại diện Chuỗi Tập Đoàn: "Mai cả phố cùng bán 36k nhé?" | **Đồng ý:** xem bảng dưới. | **Từ chối:** cartel không thành, ngày 2 các quán AI đặt giá như thường. +3 uy tín. |
| 2 | **Topping giá sốc.** Nhà cung cấp lạ mặt mời hàng không rõ nguồn gốc. | **Mua:** ngày 3–4 mọi topping có giá vốn 0,5k mỗi phần. Hai ngày đó tính là ngày ăn bớt, −3 uy tín mỗi tối. | **Không mua:** không đổi gì. |
| 3 | **Chợ đen.** Khách đứng cuối hàng dúi tiền: "Bán cho em 40k cũng được." | **Nhận:** +50k ngay. Sáng ngày 4 bị bóc phốt, −8 uy tín. | **Từ chối:** +2 uy tín. |
| 4 | **Thuế.** Cán bộ phường đưa tờ khai. | **Khai đủ:** không đổi gì. | **Khai gian:** được hoàn lại toàn bộ thuế ngày 4, không bị phạt tiền, nhưng −10 uy tín ngay tối đó. Trạm xe buýt vẫn được xây. Màn kết và bảng host gắn nhãn "ăn theo". |
| 4 | **Kiểm định.** Tin đồn nước rửa chén bắt đầu lan trên mạng. | **Tự trả 40k kiểm định:** có dưới 2 ngày ăn bớt thì đạt, quán được miễn khoản trừ tin đồn ngay từ đầu ngày 5. Có từ 2 ngày trở lên thì trượt: mất 40k và −15 uy tín ngay tối đó. | **Chờ nhà nước:** miễn phí, kết quả có ở giây 45 của trưa ngày 5. |
| 5 | **Phóng viên.** "Theo bạn, bàn tay nào cứu phố này?" | Vô hình | Hữu hình |

**Cartel khi người chơi đồng ý.** Ngày 2 cả 6 quán AI bán đúng 36k và không chỉnh giá giữa trưa.

| Người chơi làm gì ở ngày 2 | Kết quả |
|---|---|
| **Giữ lời:** giá sáng và giá sau khi đổi đều từ 36k | Lãi mỗi ly cao vì cả phố cùng giữ giá. Tối ngày 2 Cục Cạnh tranh phạt 150k và −2 uy tín. |
| **Phá thoả thuận:** có lúc bán dưới 36k | Hốt khách của cả phố. Tối ngày 2 vẫn bị phạt 150k và −2 uy tín vì đã ký thoả thuận. Sáng ngày 3 cả phố nói xấu, −8 uy tín. |

Thẻ phóng viên cũng xuất hiện trong màn kết của người thua sớm, để ai cũng có bình chọn sau.

### Thẻ phụ

Ngày 1–3 mỗi ngày rút 1 thẻ từ bộ 6 thẻ theo seed, không lặp.

| Thẻ | Đồng ý | Từ chối |
|---|---|---|
| KOL xin 3 ly miễn phí để review | −30k, sáng mai +8 uy tín | −2 uy tín |
| Khách quen xin ghi nợ | −20k hôm nay; 2 ngày sau +30k và +3 uy tín | −2 uy tín |
| Sinh viên xin phụ quán ngày mai, công 40k | −40k, ngày mai có người phụ pha như nâng cấp Nhân viên. Thẻ này không được rút nếu đã có Nhân viên. | Không đổi gì |
| Khách phàn nàn ly hôm nay nhạt, đòi đền | −15k, +3 uy tín | −3 uy tín |
| App giao hàng mời chạy quảng cáo 40k | −40k, ngày mai phố có thêm 6 khách túi tiền cao chỉ xét quán bạn | Không đổi gì |
| Phường vận động góp quỹ khuyến học | −20k, +5 uy tín | Không đổi gì |

## 8. Báo cáo tối và màn kết

**Báo cáo tối:**

- Doanh thu, tiền trà, tiền topping, thuế, tiền phạt, giá trị nguyên liệu bỏ đi, lãi ngày.
- Khách: đã phục vụ, giao sai, bỏ về vì chờ lâu, không ghé vì hết món.
- Uy tín: từng khoản thay đổi và lý do.
- Phố hôm nay: đường đi của giá từng quán từ mở cửa tới đóng cửa, số ly bán, quán nào bán hết, nghỉ bán hay đóng cửa hẳn, số khách về tay không.
- Thẻ bài học của ngày, dùng số liệu vừa xảy ra. Ví dụ ngày 1: "Sáng nay giá trên phố từ 25k đến 40k. Đến cuối trưa còn 25–38k."
- Chế độ lớp học: hạng của bạn trong số người đã xong ngày này.

**Màn kết:**

- Đoạn kết: khách quay lại, phố hồi phục, quán nào không trụ được.
- Nếu thua vì uy tín về 0: đoạn kết "Mất hết lòng tin" thay cho đoạn hồi phục, kèm danh sách những việc đã làm mất uy tín.
- Điểm: tổng lãi, giá trị thương hiệu, biểu đồ lãi theo ngày.
- Tóm tắt lựa chọn của bạn và bài học tương ứng (cartel, topping lạ, chợ đen, thuế, kiểm định).
- Solo: kỷ lục cá nhân, nút chơi lại.
- Lớp học: hạng của bạn, chờ trao giải.

## 9. Hình ảnh và chuyển động

Phần này là yêu cầu của sản phẩm. Một màn chỉ có số liệu đúng mà thiếu chuyển động thì chưa xong.

### Phong cách

- Hình vector vẽ bằng code, không dùng ảnh PNG, không pixel-art. Sắc nét ở mọi kích thước.
- Hình phẳng, bo tròn, nét mềm, dùng bảng màu hiện có của dự án: nền kem, matcha, khoai môn, caramel.
- Nhân vật có khớp (đầu, thân, tay, chân) để làm dáng đi và biểu cảm.

### Cảnh phố

Cảnh phố xuất hiện ở trưa (đầy đủ, theo mô phỏng thật), và làm nền sống cho màn tiêu đề solo, màn chờ `/play`, buổi sáng và buổi tối.

- **Bố trí:** một con đường ở giữa, quán hai bên: 4 quán phía trên, 3 quán phía dưới, quán người chơi ở giữa hàng dưới. Cùng một sơ đồ, hai bộ toạ độ cho màn dọc và màn ngang. Cả phố vừa một màn hình, không phải cuộn.
- **Khách đi bộ:** mỗi khách của mô phỏng là một nhân vật trên phố. Họ vào từ hai đầu đường (ngày 5 có thêm xe buýt thả khách ở trạm), đi dọc đường, dừng nhìn bảng giá, rồi rẽ vào xếp hàng ở quán đã chọn hoặc đi tiếp ra khỏi phố. Khách mua xong cầm ly vừa đi vừa uống.
- **Bong bóng lời nói:** lấy từ lý do thật mà mô phỏng ghi lại, nên người chơi đọc được vì sao mình được hay mất khách.

| Tình huống | Ví dụ lời nói |
|---|---|
| Giá cao hơn túi tiền | "Quán này đắt quá, đi quán khác thôi." |
| Hàng dài | "Đông quá, xếp hàng chắc lâu lắm, mình qua quán khác." |
| Uy tín dưới ngưỡng tin tưởng | "Quán này nghe nói không ổn lắm, chọn quán khác vậy." |
| Hết món hoặc hết hàng | "Hết trân châu rồi à…" |
| Quán khác tốt hơn | "Bên kia rẻ hơn mà." |
| Chọn quán người chơi | "Quán này giá ổn nè." |
| Chờ quá 25 giây | "Chờ lâu quá, thôi khỏi!" |
| Nhận ly sai | "Ủa, sai món rồi?" |
| Quán tăng giá khi đang xếp hàng | "Ủa tăng giá hả? Thôi." |
| Quán giảm giá sốc | "Giảm dữ vậy, có khi trà đểu." |
| Ngày giá trần, không mua được | "Quán nào cũng hết sạch…" |
| Ngày tin đồn | "Nghe đồn nấu bằng nước rửa chén đó." |

  Mỗi tình huống có 3–4 câu để không lặp. Cùng lúc hiện tối đa 3 bong bóng, ưu tiên khách liên quan tới quán người chơi.
- **Nhân vật khách:** dựng từ một bộ khung có tham số (dáng người, tóc, màu da, trang phục, phụ kiện), sinh theo seed thành hàng chục kiểu: học sinh, dân văn phòng, shipper, cụ ông, bà nội trợ, KOL. Chuyển động: dáng đi, đứng thở, cúi nhìn điện thoại, ngẩng nhìn bảng giá, nhích lên trong hàng, vui (nhảy nhẹ, tim bay), sốt ruột (gõ chân), bực bỏ đi (dậm chân), vừa đi vừa uống.
- **7 quán có cá tính riêng:** xe đẩy cũ của Bà Tư, biển neon SALE của Chuỗi GiáRẻ, quán gỗ của Ông Cố Chấp, quầy dán đầy biểu đồ của Anh Lướt Sóng, gian hàng tự chế của Sinh Viên, mặt kính bóng của Chuỗi Tập Đoàn, và quán người chơi.
- **Trạng thái quán:** đang mở; hết hàng (lật biển); nghỉ bán (kéo cửa cuốn); đóng cửa hẳn (treo biển sang nhượng); khai trương (bóng bay, băng rôn); bảng giá lật số khi đổi giá; đồng xu nảy lên khi bán được; chủ quán ngáp khi ế và lau mồ hôi khi đông; huy hiệu "Đã kiểm định".
- **Không khí phố:** ánh sáng đổi theo nhịp trong ngày (sáng ấm, trưa gắt, chiều vàng, tối lên đèn), cây đung đưa, xe máy chạy ngang, con mèo đi dạo.
- **Đạo cụ theo ngày:**
  - Ngày 2: lễ khai trương Chuỗi Tập Đoàn.
  - Ngày 3: loa phường và biển "GIÁ TRẦN 20K", hàng người dài, khách ra về tay không.
  - Ngày 4: cán bộ thuế đi từng quán, công trường trạm xe buýt.
  - Ngày 5: khách xì xào chỉ trỏ; giây 45 xe loa phường chạy qua công bố kiểm định, huy hiệu gắn lên các quán, khách ùa lại; xe buýt ghé trạm thả khách.

### Bảng pha chế

- Ly đặt xuống quầy nảy nhẹ. Đá rơi từng viên. Trà rót thành dòng, mực trà dâng và sóng sánh, màu theo loại trà. Topping rơi và nảy dưới đáy ly. Nắp và ống hút cắm vào khi ly xong.
- Kéo ly: ly nghiêng theo quán tính. Thả đúng khách: khách vui, tiền bay về ô tiền và con số chạy lên. Thả sai: khách nhăn mặt, hiện dấu hỏi, số tiền bị cắt hiện màu đỏ ("−30%"). Bỏ ly: ly bay vào thùng rác.
- 4 khách ở quầy là chân dung lớn có biểu cảm đổi theo thanh kiên nhẫn.
- Nhân viên là một nhân vật pha ở quầy bên.

### Các màn khác

- **Mở đầu mỗi ngày:** thẻ tiêu đề kiểu điện ảnh ("Ngày 3 · Giá trần 20k") trượt trên cảnh phố đổi ánh sáng.
- **Sáng:** kệ hàng đầy dần khi tăng số trà và topping; xe giao hàng tới khi bấm Mở cửa.
- **Thẻ:** thẻ được chia ra, nhân vật trên thẻ chớp mắt và có cử chỉ, vuốt thì thẻ nghiêng theo tay và bay đi.
- **Báo cáo:** số chạy lên, cột dựng dần, đường giá vẽ ra, thanh uy tín đổi từng nấc.
- **Màn kết:** pháo giấy khi thắng; cửa cuốn kéo xuống khi thua.

### Bố cục

| Màn hình | Trưa | Các màn còn lại |
|---|---|---|
| Điện thoại dọc | Phố trọn màn hình. Bảng pha chế trượt lên từ dưới, che khoảng 60%. | Một cột trên nền phố |
| Điện thoại ngang | Phố trọn màn hình. Bảng pha chế trượt vào từ phải, che khoảng 50%. | Hai cột |
| Máy tính (rộng từ 1100px) | Phố và bảng pha chế hiện cạnh nhau, bảng vẫn đóng được | Khung căn giữa trên nền phố |

- Xoay máy giữa ván thì bố cục đổi theo, trạng thái giữ nguyên.
- Khung chơi chiếm trọn chiều cao màn hình, không cuộn trang, không bị kéo trang khi đang kéo ly.

### Kỹ thuật dựng hình

- **Cảnh phố vẽ trên Canvas 2D** bằng một lớp cảnh tự viết trong `web/src/scene/`: hàm vẽ từng loại nhân vật và quán, khung khớp, bộ nội suy chuyển động, sắp lớp theo chiều sâu, hạt (đồng xu, tim, pháo giấy). Bong bóng lời nói cũng vẽ trên canvas.
- **Bảng pha chế và mọi màn giao diện** dùng DOM, SVG và Framer Motion như hiện tại.
- Cảnh phố chỉ để hiển thị. Nó nhận sự kiện từ mô phỏng và không bao giờ làm đổi kết quả. Hình trên phố được phép trễ so với mô phỏng tối đa 1,5 giây (khách còn đang đi tới quán khi mô phỏng đã tính họ vào hàng).
- Mục tiêu 60 khung hình mỗi giây trên điện thoại tầm trung. Tối đa 40 nhân vật cùng lúc. Mật độ điểm ảnh của canvas giới hạn ở 2. Dừng vẽ khi tab bị ẩn.
- `prefers-reduced-motion`: tắt không khí phố và hạt, giữ các thay đổi trạng thái cần để chơi.

## 10. Kiến trúc

Toàn bộ mô phỏng chạy trên trình duyệt. Server chỉ quản lý buổi học và nhận kết quả.

```
shared/
  sim/
    rng.ts         PRNG có seed (chuyển từ server/game/random.ts)
    config.ts      mọi con số chỉnh được, lịch 5 ngày
    types.ts       RunState, MorningPlan, RushState, Action, SimEvent, DaySummary
    customers.ts   sinh khách của một ngày từ seed
    shops.ts       luật 6 quán AI: giá sáng, chỉnh giá giữa trưa, nghỉ bán, rút lui
    choice.ts      chấm điểm quán và ghi lý do
    rush.ts        engine trưa: createRush, step(state, actions) → state + sự kiện
    cards.ts       định nghĩa thẻ, applyChoice
    day.ts         openDay (áp kế hoạch sáng), closeDay (báo cáo, uy tín, DaySummary)
    run.ts         newRun(seed), chuyển nhịp, điểm, màn kết
    autoplay.ts    các lối chơi tự động, dùng cho giả lập, bot và test
  protocol.ts      sự kiện socket, snapshot, giới hạn tên và số người
server/
  session.ts       buổi học: seed, người chơi, bình chọn, kết quả, xếp hạng, lưu file
  awards.ts        tính giải từ DaySummary
  app.ts           express + socket.io, phục vụ /, /solo, /play, /host
web/src/
  main.tsx         định tuyến 4 đường dẫn
  scene/           lớp cảnh Canvas: khung khớp, nhân vật, quán, đạo cụ, hạt, bong bóng,
                   bộ chuyển sự kiện mô phỏng thành chuyển động
  game/            runStore (máy trạng thái ván + lưu ván, logic thuần),
                   reportQueue (hàng đợi gửi kết quả, logic thuần),
                   useRun (nối hai thứ trên với đồng hồ và React), storage, format
  net/socket.ts    kết nối socket, chỉ tạo khi Play hoặc Host gọi tới
  pages/Game/      Game, DayTitle, MorningScreen, RushScreen, CraftPanel, CardScreen,
                   ReportScreen, EndScreen
  pages/Solo/      Solo (bọc Game ở chế độ solo)
  pages/Play/      Play, JoinScreen, LobbyScreen (bọc Game ở chế độ lớp học)
  pages/Host/      Host, ProjectorView, BoardView, AwardsView, HostControls
  ui/              UI kit hiện có
scripts/
  balance.ts       giả lập không giao diện
  bots.ts          lớp học giả để tổng duyệt bảng host
```

Ranh giới giữa các phần:

- `shared/sim` không biết gì về React, canvas, socket hay đồng hồ thật. Nó nhận seed và hành động, trả về trạng thái mới và sự kiện.
- `web/src/scene` chỉ biết sự kiện và trạng thái để vẽ. Nó không gọi ngược vào mô phỏng.
- `web/src/game/useRun` là nơi duy nhất nối mô phỏng với đồng hồ, bộ nhớ máy và mạng.
- Các màn trong `pages/Game` nhận trạng thái và phát hành động. Chúng dùng chung cho solo và lớp học.
- Solo không import `net/socket.ts`, nên không mở kết nối nào tới server.
- Server không chạy mô phỏng.

Việc cần chỉnh trong cấu hình dự án:

- `server/app.ts` phục vụ thêm `/solo`.
- `vitest.config.ts` chạy test trong `shared/` và `web/src/game/`, không chỉ `server/`.
- `tsconfig.json` gồm cả `scripts/`. Thêm lệnh `npm run balance` và `npm run bots`.

### Lưu ván

- Lưu `RunState` vào `localStorage` ở mỗi lần chuyển nhịp. Solo và lớp học dùng khoá riêng; khoá lớp học gắn với mã buổi.
- Tải lại trang giữa trưa: quay về buổi sáng của ngày đó, các lựa chọn buổi sáng được điền lại, chưa bị trừ tiền.
- Mã buổi đổi (host bấm Reset): bỏ ván cũ, về màn chờ.

## 11. Chế độ lớp học

Trạng thái buổi: `lobby` → `open` → `awards`.

### Giao thức

| Sự kiện | Hướng | Nội dung |
|---|---|---|
| `player:join`, `player:resume` | máy → server | Như hiện tại |
| `player:vote` | máy → server | Bình chọn trước khi chơi |
| `player:progress` | máy → server | Ngày và nhịp đang chơi |
| `player:day` | máy → server | Mã ván và `DaySummary` của một ngày. Trả về hạng trong số người đã xong ngày đó. |
| `state` | server → mọi máy | Trạng thái buổi, mã buổi, seed, số người. Ở `awards` có thêm giải và top 5. |
| `host:auth`, `host:open`, `host:awards`, `host:reset` | host → server | Điều khiển buổi |
| `host:board` | server → host | Toàn bộ bảng theo dõi |

- **Mã ván:** máy tự sinh khi bắt đầu ván. Server nhớ mã ván đầu tiên của mỗi người và bỏ qua mọi kết quả mang mã khác. Server chỉ nhận ngày kế tiếp; gửi trùng thì bỏ qua.
- **`DaySummary`** gồm: ngày; giá sáng và giá đóng cửa; loại trà; trà và topping đã mua và đã dùng; giá trị nguyên liệu bỏ đi; số ly bán; số ly giao sai; số khách bỏ về; doanh thu, chi phí, thuế, tiền phạt, lãi; tiền và uy tín cuối ngày; điểm tạm tính; nâng cấp đã mua; các thẻ và lựa chọn; cờ thua vì uy tín về 0.
- Người thua sớm được tính là đã xong ván và vẫn được xếp hạng theo điểm.
- Server chỉ kiểm tra kiểu dữ liệu và khoảng giá trị để không lỗi. Không kiểm chứng điểm.
- Máy giữ hàng đợi các `DaySummary` chưa gửi được và gửi lại theo thứ tự khi có mạng. Mất mạng không làm dừng ván.
- **Server khởi động lại:** trạng thái buổi (seed, mã buổi, người chơi, kết quả, bình chọn) được ghi ra một file JSON mỗi khi thay đổi và nạp lại lúc khởi động. Các ván đang chơi tiếp tục bình thường.

### Màn host

`/host` có hai chế độ xem, đổi bằng một nút:

- **Màn chiếu** (để chiếu cho cả lớp): QR và số người đã vào khi ở lobby; cảnh phố làm nền và số người đang chơi, đã xong khi chợ mở; giải khi trao giải. Không hiện thông tin của từng người.
- **Bảng theo dõi** (riêng tư, chỉ gửi cho socket đã xác thực `HOST_KEY`):
  - **Dải tổng quan:** số người đã vào, đang chơi, đã xong, thua sớm. Giá trung bình của lớp theo từng ngày. Tỉ lệ từng lựa chọn. Bình chọn trước và sau, tính trên những người có cả hai, kèm số người.
  - **Bảng thành viên**, xếp theo điểm: tên, kết nối, tiến độ (ngày và nhịp), điểm, tổng lãi, uy tín, giá gần nhất, số ly bán, số ly giao sai, số khách bỏ về, nhãn lựa chọn, bình chọn trước → sau.
  - Bấm vào một dòng để mở chi tiết từng ngày của người đó.

Nhãn lựa chọn:

| Nhãn | Nghĩa |
|---|---|
| 🥄 | Có ngày dùng trà ăn bớt |
| 🤝 / 🗡️ | Đồng ý cartel và giữ lời / đồng ý rồi phá |
| 📦 | Mua topping giá sốc |
| 💵 | Nhận tiền chợ đen |
| 🐀 | Khai gian thuế |
| ✅ / ❌ | Tự kiểm định đạt / trượt |

Nút điều khiển: Mở chợ, Trao giải, Reset (có hộp xác nhận).

Người chơi không lưu được `localStorage` mà tải lại trang sẽ vào lại như một người mới. Bảng host hiện cả hai dòng. Đây là giới hạn được chấp nhận.

### Giải

| Giải | Tiêu chí | Khi hoà |
|---|---|---|
| 🏆 Đại Gia Trân Châu | Điểm cao nhất | Tổng lãi cao hơn |
| ⭐ Quán Quốc Dân | Uy tín cuối cao nhất | Điểm cao hơn |
| 📦 Ông Hoàng Tồn Kho | Giá trị nguyên liệu bỏ đi nhiều nhất | Điểm cao hơn |
| 🎯 Bàn Tay Vàng | Tỉ lệ giao sai thấp nhất, tối thiểu 30 ly | Bán nhiều ly hơn |

Giải tính trên những ngày đã gửi về tại lúc host bấm Trao giải.

## 12. Dọn dẹp

**Xoá:**

- Slide: `web/src/pages/Presentation/`, `web/src/content/`, `web/public/img/`, các kiểu `.deck` dành cho slide.
- Game cũ trên server: `server/game/` (market, engine, awards và test của chúng; `random.ts` chuyển sang `shared/sim/rng.ts`).
- `shared/config.ts`, `shared/types.ts` (giới hạn tên và số người chuyển sang `shared/protocol.ts`).
- Màn cũ: `PricingScreen`, `EventScreen`, `RevealScreen`, `AwardsScreen` trong Play; `EventView`, `PricingView`, `RevealView`, `Leaderboard`, `EmojiRain`, `commentary.ts` trong Host.
- Tính năng thả emoji.
- Component trong `web/src/ui/` không còn nơi nào dùng sau khi viết lại.
- `docs/huong-dan-thuyet-trinh.md`, spec và plan cũ ngày 2026-11-14 (vẫn còn trong lịch sử git).
- Tên cũ: tiêu đề và mô tả trong `web/index.html`; dòng log và mã host mặc định `hai-ban-tay` trong `server/index.ts`; các khoá lưu trữ `hbt.*` (đổi thành `pts.*`); mọi chỗ còn ghi "Hai Bàn Tay" hay "Chợ Trà Sữa Hỗn Loạn".

**Giữ:** UI kit và token giao diện, `JoinQR`, `ConnectionBadge`, `Modal`, `useStageScale` (dùng để co giãn khung chơi), cơ chế host key, kết nối lại, dự phòng long-polling, Dockerfile, cách deploy.

**Viết lại:** `README.md` (chỉ nói về game), `web/src/net/socket.ts` (tách phần lưu trữ ra, chỉ kết nối khi được gọi), `scripts/bots`.

**Tạo mới:** `docs/huong-dan-host.md` (cách chạy một buổi).

## 13. Xử lý lỗi

- Mất mạng ở chế độ lớp học: ván chạy tiếp, hiện huy hiệu mất kết nối, kết quả gửi bù khi có mạng.
- `localStorage` không dùng được: ván vẫn chơi được, chỉ không khôi phục sau khi tải lại.
- File lưu buổi hỏng hoặc không ghi được: server ghi log và chạy tiếp với trạng thái trong RAM.
- Vào `/play` khi buổi đã trao giải: thông báo buổi đã kết thúc và mời chơi solo.
- Canvas không khởi tạo được: trưa vẫn chơi được với dải phố dạng danh sách (tên quán, giá, số người xếp hàng).
- Sự kiện sai trạng thái buổi, sai host key, dữ liệu sai kiểu: server bỏ qua.

## 14. Kiểm thử

**Test engine (Vitest, `shared/sim`):**

- Cùng seed và cùng chuỗi hành động cho cùng kết quả và cùng chuỗi sự kiện.
- Khách: chỉ xét quán đạt ngưỡng tin tưởng và còn hàng cho đơn; chọn điểm cao nhất; rời phố khi không quán nào dương; chọn lại đúng một lần khi hết kiên nhẫn; lý do ghi lại khớp với thành phần quyết định.
- Quán AI: giá ngày đầu; từng luật giá sáng; kẹp giá; chỉnh giá ở giây 30 và 60; giá tự do gần nhất ở ngày 4; cộng thuế; nghỉ bán dưới giá trần; đóng cửa sau 2 ngày lỗ.
- Số khách của phố không đổi khi số quán thay đổi.
- Pha chế: thứ tự bước; bấm trước tối đa 3 bước; trừ đúng ml theo size và đúng phần topping; giao đúng; giao sai thu 70% giá ly rẻ hơn, làm tròn xuống, kể cả khi ly thực nhận đắt hơn đơn gọi; thùng rác; còn 300 ml thì làm được S nhưng không làm được M; khách rời hàng khi hết hàng cho đơn; nhân viên pha song song; máy pha giảm nửa thời gian rót.
- Biên thời gian: hết 90 giây khi đang pha dở; khách đến ở giây 75; đóng cửa sớm.
- Đổi giá: chỉ 1 lần; chấm lại điểm ở quán uy tín cao và uy tín thấp; đúng 20% thì chưa bị phạt; phép thử đa nghi khi giảm sâu; không vượt giá trần.
- Chính sách: giá trần gây thiếu hụt trên nhánh từ chối cartel; thuế trừ đúng; ngày 5 nửa nhịp trước giây 45 và đủ nhịp sau đó; khoản trừ tạm được gỡ đúng quán.
- Từng thẻ: hậu quả ngay và hậu quả trễ, gồm ba kết cục của cartel và hai kết cục của kiểm định.
- Uy tín: đúng từng khoản ở hai thời điểm; kẹp 0–100; phục vụ sạch +3; về 0 thì ván kết thúc, kể cả ở tối ngày 5; khoản trừ tạm không gây thua.
- Điểm: tổng lãi cộng giá trị thương hiệu.

**Test logic phía máy (`web/src/game`):**

- `runStore`: tải lại giữa trưa quay về buổi sáng và chưa trừ tiền; mã buổi đổi thì bỏ ván; khôi phục đúng ở từng nhịp.
- `reportQueue`: gửi lại đúng thứ tự, không gửi trùng, giữ hàng đợi qua lần tải lại trang.

**Giả lập cân bằng (`scripts/balance.ts`):** chạy nhiều seed với các lối chơi trong `autoplay.ts`. Mỗi lối chơi quy định giá, lượng nhập, loại trà, lựa chọn thẻ, thứ tự phục vụ, tỉ lệ giao sai và độ trễ mỗi thao tác. Các lối chơi: hợp lý, luôn 15k, luôn 45k, luôn ăn bớt, luôn cao cấp, nhập dư gấp đôi, nhập thiếu một nửa, giao ly S không topping cho mọi khách, gian lận dồn vào ngày 5, độ trễ thao tác 0,1 giây và 0,6 giây, và mọi tổ hợp lựa chọn thẻ cốt truyện.

Giả lập báo lỗi khi:

- Lối chơi hợp lý lỗ ở bất kỳ ngày nào trong ngày 1–4, hoặc thua vì uy tín về 0.
- Ngày 5 còn dưới 3 quán AI mở cửa trên lối chơi hợp lý.
- Một lối chơi cực đoan (15k, 45k, luôn ăn bớt, giao ly S cho mọi khách, gian lận ngày 5) có điểm cao hơn lối chơi hợp lý.
- Giá đóng cửa trung bình của phố ngày 1 nằm ngoài 28–36k, hoặc ngày 2 trên nhánh từ chối cartel không thấp hơn ngày 1 ít nhất 3k.
- Ngày giá trần có dưới 25% người đủ tiền phải về tay không, trên bất kỳ nhánh cartel nào.
- Độ trễ thao tác 0,1 giây và 0,6 giây chênh nhau quá 15% điểm.
- Cartel: lãi ngày 2 của nhánh giữ lời, trước khi bị phạt, không cao hơn nhánh từ chối. Hoặc một nhánh đồng ý có điểm cuối cao hơn nhánh từ chối. Hoặc nhánh từ chối hơn nhánh tốt thứ hai quá 150k.
- Một thẻ hai nhánh có nhánh luôn hơn nhánh kia quá 80k điểm.
- Luôn cao cấp hơn hoặc kém lối chơi hợp lý quá 100k điểm.
- Dưới 70% số seed có ít nhất một quán AI đóng cửa trước ngày 5 trên lối chơi hợp lý.

**Test server:** vào buổi, khôi phục, bình chọn, mở chợ, gửi ngày theo thứ tự, bỏ qua ngày trùng và mã ván khác, xếp hạng theo ngày, giải và luật hoà, reset đổi mã buổi, bảng host chỉ đến socket đã xác thực, ghi và nạp lại file buổi, `/solo` trả về trang.

**Kiểm tra tay trên trình duyệt:**

- Trọn một ván ở điện thoại dọc, điện thoại ngang và máy tính; xoay máy giữa trưa.
- Kéo thả bằng cảm ứng và chuột; trang không bị cuộn khi kéo ly.
- Đối chiếu từng mục trong danh sách chuyển động ở mục 9.
- Đo tốc độ khung hình ở ngày giá trần (đông nhất) trên một điện thoại tầm trung.
- Bật `prefers-reduced-motion`.
- Tải lại trang ở từng nhịp; tắt mạng giữa ván rồi bật lại.
- Một buổi lớp học với `scripts/bots`, cả màn chiếu lẫn bảng theo dõi; khởi động lại server giữa buổi.

## 15. Thứ tự xây dựng

Kế hoạch code chia thành 5 giai đoạn, mỗi giai đoạn chạy và kiểm được riêng:

1. **Mô phỏng và cân bằng:** `shared/sim`, test engine, `scripts/balance.ts`. Xong khi giả lập không còn báo lỗi.
2. **Cảnh phố và hình vẽ:** `web/src/scene`, nhân vật, quán, bong bóng, đạo cụ theo ngày. Kiểm bằng một trang xem thử phát lại một trưa do `autoplay` chơi.
3. **Các màn chơi:** sáng, trưa với bảng pha chế, thẻ, báo cáo, màn kết, lưu ván, ba bố cục. Xong khi chơi được trọn ván ở `/solo`.
4. **Lớp học:** `server/session`, giao thức, `/play`, `/host`, giải, bot.
5. **Dọn dẹp và tài liệu:** xoá slide và game cũ, đổi tên, README, hướng dẫn host.

## 16. Bổ sung khi lập kế hoạch

Các điểm sau chốt những chỗ các mục trên để ngỏ; chúng có hiệu lực như phần còn lại của spec.

| # | Mục | Chốt |
|---|---|---|
| 1 | 4, chỉnh giá giữa trưa | Ngưỡng là 33% (giây 30) và 66% (giây 60) cho cả tăng lẫn giảm: đó là mức tối đa một quán AI bán kịp ở hai mốc này (7s/ly: 4 và 8 trên 12 ly; 5s/ly: 6 và 12 trên 18 ly). Vì vậy quán chỉ tăng giá khi bán hết công suất hoặc hàng có từ 4 người, và giảm giá khi không ai xếp hàng mà chưa bán kịp mức đó |
| 2 | 4, khách | Khách không vào hàng đã có từ 5 người; lý do ghi là "đông quá" |
| 3 | 6, còn hàng | Ly đang pha "giữ chỗ" cho khách đầu tiên trong 4 khách ở quầy có cùng size và gọi đủ mọi topping đã có trong ly; khách đó không bị đuổi khi kho hết vì chính ly ấy |
| 4 | 6, bấm trước | Chỉ 4 bước đầu (size, đá, trà, topping) bấm trước được. Giao tính tiền ngay khi thả, rồi quầy bận 0,4s |
| 5 | 4 và 6, chọn lại quán | Mọi trường hợp rời hàng (hết kiên nhẫn, hết hàng, đổi giá, đóng cửa sớm) đều chọn lại trong các quán chưa ghé, với 25 giây kiên nhẫn mới, nếu khách mới ghé 1 quán |
| 6 | 6, đổi giá | Khi chấm lại điểm sau đổi giá, "số người xếp hàng" là số người đứng trước khách đó |
| 7 | 6, đóng cửa sớm | Hàng khách của quán người chơi xử lý như hết hàng: chọn lại quán, không trừ uy tín |
| 8 | 4, tin đồn | "Nửa nhịp" trước giây 45 nghĩa là một nửa số khách đến trước giây 45 là khách sợ: họ đi ngang phố mà không mua, kèm bong bóng tin đồn |
| 9 | 4, tin đồn | Số ngày ăn bớt đếm lúc mở cửa mỗi ngày, nên ăn bớt ở ngày 5 cũng bị tính khi nhà nước công bố ở giây 45. Quán đã tự kiểm định không bị xét lại |
| 10 | 4, uy tín | Các khoản buổi tối cộng lại rồi kẹp 0–100 một lần. Chỉ xét thua ở buổi tối |
| 11 | 4, phục vụ sạch | Cần bán ít nhất 1 ly mới được +3 |
| 12 | 4, giá tự do gần nhất | Khi luật quán AI nói "hôm qua" hay "hôm kia", bỏ qua ngày bị giá trần, ngày quán nghỉ bán và ngày cartel. Sáng ngày 5, giá đóng cửa ngày 4 được trừ lại 3k thuế trước khi áp luật |
| 13 | 8, lãi ngày | Lãi ngày = doanh thu − trà − topping − thuế − phạt. Tiền nâng cấp và tiền thẻ ghi dòng riêng |
| 14 | 7, thẻ | Tiền của thẻ luôn được trừ, kể cả khi tiền đã dưới −150k. Thẻ phụ trước, thẻ cốt truyện sau |
| 15 | 11, giao thức | Bình chọn gửi bằng `player:vote { when: 'before' \| 'after' }`, gửi qua hàng đợi kết quả. Snapshot lúc trao giải có hạng của mọi người |
| 16 | 14, cân bằng | Ngưỡng tính trên trung bình các seed; riêng "thua vì uy tín" là bất kỳ seed nào. "Giá trung bình phố" gồm cả người chơi |
