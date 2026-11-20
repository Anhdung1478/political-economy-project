# Kế hoạch triển khai "Phố Trà Sữa"

**Spec (nguồn sự thật):** `docs/superpowers/specs/2026-11-19-pho-tra-sua-design.md`. Mọi luật chơi, con số và câu chữ hiển thị lấy từ spec. Kế hoạch này chỉ chia việc, chốt quy ước kỹ thuật và ghi những chỗ spec để ngỏ. Nếu kế hoạch và spec mâu thuẫn, spec thắng, trừ mục "Bổ sung khi lập kế hoạch" (mục 16 của spec, viết ở Task 1) vốn là phần mở rộng đã duyệt của spec.

**Nhánh:** `pho-tra-sua`. Không push.

## Ràng buộc chung (mọi task)

### Quy trình

- Mỗi task kết thúc với `npm test` và `npm run typecheck` đều xanh, output test sạch (không warning thừa).
- TDD cho mọi logic thuần (`shared/`, `server/`, `web/src/game/`, `web/src/scene/director.ts`): viết test trước, chạy cho đỏ, rồi viết code cho xanh.
- Commit theo kiểu hiện có của repo (`feat(sim): …`, `test: …`, `docs: …`). Mỗi commit message kết thúc bằng dòng:
  `Claude-Session: https://claude.ai/code/session_013QapQ4gZ7nVLf11CEG8uj9`
- Không đụng tới `package.json.lnk`. Không thêm dependency ngoài những gì task cho phép.
- Phong cách code theo repo: TypeScript strict, ESM, 2 dấu cách, nháy đơn, có chấm phẩy, `noUnusedLocals`. Tên định danh tiếng Anh; mọi chữ hiển thị cho người chơi bằng tiếng Việt, giọng bựa nhẹ như spec.
- Không viết code "phòng khi cần". Chỉ làm điều task yêu cầu.

### Quy ước của `shared/sim`

- `shared/sim` không import React, DOM, socket, `Date`, `Math.random`. Mọi hàm thuần; kết quả chỉ phụ thuộc đầu vào.
- **Tiền** (`K`): nghìn đồng, luôn là bội số của 0,5. **Điểm chọn quán** là số nguyên tính bằng phần mười nghìn đồng: `score10 = budget*10 − price*10 + (rep − 50)*2 − 20*queueAhead`. Không so sánh số thực.
- Chỉ dùng phép cộng, trừ, nhân, chia, `Math.floor/round/min/max/abs`. Không `Math.pow/exp/sin/log` trong sim.
- **Thời gian** (`Tick`): số nguyên, 1 nhịp = 100 ms. Một trưa là nhịp 0..900. Mọi thời lượng trong config là số nguyên nhịp.
- **Giao sai:** tiền thu `Math.floor(Math.min(orderPrice, cupPrice) * 7 / 10)`; không bao giờ `0.7 * x`.
- Mọi hàm nhận `cfg: SimConfig = CONFIG` làm tham số cuối.
- `RunState` là dữ liệu thuần, qua được `JSON.parse(JSON.stringify(x))` không đổi. `RushState` không được lưu, không chứa trạng thái ngẫu nhiên.
- **Ngẫu nhiên:** không có bộ sinh dùng chung. Mỗi nơi lấy luồng riêng `stream(seed, key)`:

| Khoá | Dùng cho |
|---|---|
| `cust/{day}/{i}` | Đặc điểm khách thứ i (thứ tự rút cố định) |
| `strata/{day}/budget`, `strata/{day}/trust` | Hoán vị tầng để trải đều túi tiền và ngưỡng tin tưởng |
| `look/{day}/{i}` | Ngoại hình, chỉ cảnh phố dùng |
| `ad/{day}/{j}` | 6 khách của thẻ quảng cáo |
| `side-deck` | Thứ tự thẻ phụ |
| `bot/{day}` | Bot giả lập, chung cho mọi lối chơi (R39); không bao giờ vào sim |
| `scene/{day}` | Cảnh phố (câu thoại, không khí); không bao giờ vào sim |

  Trưa không rút số ngẫu nhiên lúc chạy: hoà điểm (`tie`), độ đa nghi (`skeptic`), khách sợ (`scared`) đều rút sẵn khi tạo khách. Số khách chỉ phụ thuộc ngày, nên cùng seed cho cùng khách bất kể người chơi làm gì.
- **Thứ tự trong một nhịp `t`** (cố định; test so chuỗi sự kiện):
  1. Hành động người chơi theo thứ tự mảng. Hành động sai phát `inputRejected`, không đổi gì.
  2. Mốc thời gian: `rushStart` ở 0; quán AI chỉnh giá ở 300 và 600 theo thứ tự slot, rồi hàng của quán đổi giá chấm lại điểm; công bố kiểm định ở 450 (ngày 5).
  3. `customerEnter` cho khách có `arriveTick − enterLeadTicks == t` (cảnh phố cần thấy khách đi tới trước khi họ chọn).
  4. Khách có `arriveTick == t`, theo thứ tự id: chấm điểm, vào hàng hoặc rời phố.
  5. Sản xuất: animation của người chơi kết thúc và bước bấm trước kế tiếp bắt đầu; nhân viên; quán AI theo thứ tự slot.
  6. Nếu kho người chơi đổi trong nhịp này: xét lại hàng, khách hết hàng cho đơn rời hàng.
  7. Hết kiên nhẫn: `t − joinedTick >= patienceTicks` thì rời hàng. Chạy sau sản xuất, nên ly xong cùng nhịp thắng.
  8. Lật biển hết hàng; hàng của quán AI hết hàng rời đi.
  9. `tick = t + 1`. Tới 900: khách còn trong hàng ra về (`rushEnd`, không trừ uy tín), ly dở bị bỏ, `done = true`.
- **Hiệu năng:** `step(state, actions)` là API công khai, không đổi `state` đầu vào. Bên trong có `advance(draft, actions, cfg, events)` đổi trực tiếp một bản nháp; `step` = sao chép phần thay đổi được + `advance`. Mảng `customers` bất biến nên không sao chép. `finishRush` và `autoplay.playRush` sao chép một lần rồi lặp `advance`. Mục tiêu: một ván 5 ngày do bot chơi chạy dưới 100 ms.

### Những chỗ spec để ngỏ, đã chốt cho implementer

Ngoài 16 điểm ở mục 16 của spec (Task 1 ghi vào), các điểm sau cũng ràng buộc:

- **Nhịp phục vụ của quán AI:** đồng hồ phục vụ chỉ chạy khi có khách chờ phục vụ được; xong `ticksPerCup` nhịp thì giao cho khách đầu hàng (đúng món) và bắt đầu ly kế.
- **Nhân viên (nâng cấp hoặc thẻ sinh viên):** đồng hồ 90 nhịp chỉ chạy khi trong hàng có khách phục vụ được mà không phải khách đang được "giữ chỗ" bởi ly của người chơi; hết 90 nhịp thì phục vụ đúng món cho khách đầu tiên như vậy theo thứ tự hàng, trừ kho của quán, rồi đếm lại từ 0.
- **Sinh khách:** `pL = 0.25 + 0.3·(budget − 37.5)/45`, `pS = 0.25 − 0.3·(budget − 37.5)/45`, `pM = 0.5`. Số topping 1/2/3 với 50/35/15%; chọn loại không lặp theo trọng số trân châu 2, thạch 1, pudding 1; lưu theo thứ tự chuẩn trân châu → thạch → pudding. `skeptic` nguyên đều 0..1000. `arriveTick` nguyên đều trong [0, 750). `entry` trái/phải 50/50; ngày 5 thêm 20% khách đi `bus`. `tie` nguyên 0..6. `scared`: chỉ ngày 5, khách có `arriveTick < 450` với xác suất 0,5.
- **Túi tiền và ngưỡng tin tưởng trải đều theo tầng:** với N khách, tầng k (đã hoán vị bằng `strata/...`) cho `15 + 45·(k + u)/N` làm tròn tới 0,5 (u đều trong [0,1)); ngưỡng tin tưởng tương tự trên [0, 50], làm tròn nguyên.
- **Khách quảng cáo** (thẻ app giao hàng): túi tiền đều trong [40, 60], ngưỡng tin tưởng 0, chỉ xét quán người chơi, đến đều trong 75 giây.
- **Doanh thu quán AI** là tổng giá tại lúc bán của từng ly (giá có thể đổi giữa trưa).
- **"Khách về tay không"** (mọi ngày, báo cáo chỉ nhấn mạnh ngày 3): khách có túi tiền ≥ giá thấp nhất của các quán đang mở lúc họ đến, rời phố mà không mua được, không tính khách sợ.
- **Lãi ngày** = doanh thu − tiền trà − tiền topping − thuế − phạt. Tiền nâng cấp và tiền thẻ ghi dòng riêng trong báo cáo, không tính vào lãi ngày; vẫn tính vào tiền và điểm.

## Phân công

Mọi task review bởi Fable 5.2. Model và effort của implementer:

| Task | Nội dung | Implementer |
|---|---|---|
| 1 | Hoàn tất spec, commit tài liệu | Sonnet, medium |
| 2 | Nền sim: cấu hình test, rng, types, config | Opus, high |
| 3 | Khách và chọn quán | Opus, high |
| 4 | Quán AI | Opus, high |
| 5 | Engine trưa: phố | Opus, xhigh |
| 6 | Engine trưa: pha chế, giao hàng | Opus, xhigh |
| 7 | Engine trưa: đổi giá, ngày 5, tất định | Opus, high |
| 8 | Khởi tạo ván và thẻ | Opus, high |
| 9 | Buổi sáng và mở cửa | Opus, high |
| 10 | Buổi tối, chuyển ngày, điểm | Opus, high |
| 11 | Bot tự chơi | Opus, high |
| 12 | Bộ giả lập cân bằng | Opus, medium |
| 13 | Chỉnh số cân bằng | Fable, high |
| 14 | Nền cảnh phố, trang xem thử, công cụ chụp | Opus, xhigh |
| 15 | Nhân vật khách | Opus, xhigh |
| 16 | Quán, đạo cụ, ánh sáng, hạt | Opus, xhigh |
| 17 | Bong bóng lời nói, chế độ nền, hiệu năng | Opus, high |
| 18 | Kho lưu, lưu ván, đồng hồ | Opus, high |
| 19 | Khung game và buổi sáng | Opus, high |
| 20 | Màn trưa và bảng pha chế | Opus, xhigh |
| 21 | Thẻ, báo cáo, màn kết | Opus, high |
| 22 | Chế độ solo, gỡ slide | Sonnet, high |
| 23 | Giao thức, buổi học, giải, lưu file | Opus, high |
| 24 | Nối server mới, hàng đợi gửi, gỡ game cũ | Opus, high |
| 25 | Màn người chơi lớp học | Opus, medium |
| 26 | Màn host | Opus, high |
| 27 | Bot tổng duyệt | Sonnet, high |
| 28 | Dọn dẹp, đổi tên | Sonnet, medium |
| 29 | Tài liệu | Sonnet, medium |

---

## Giai đoạn 0: tài liệu

### Task 1: Hoàn tất spec và commit tài liệu

**File:** `docs/superpowers/specs/2026-11-19-pho-tra-sua-design.md`, `docs/superpowers/plans/2026-11-20-pho-tra-sua.md` (file này, chỉ commit, không sửa).

1. Dòng trạng thái đầu spec: đổi "chờ duyệt" thành "đã duyệt".
2. Sửa trực tiếp trong spec:
   - Mục 4 "Chỉnh giá giữa trưa": ngưỡng tăng giá đổi thành "đã bán được 25% hàng (giây 30) hay 60% hàng (giây 60)".
   - Mục 4 "Khách": thêm gạch đầu dòng "Khách không vào hàng đã có từ 5 người trở lên; lý do ghi là đông quá."
   - Mục 14, danh sách "Giả lập báo lỗi khi": thêm "Ngày 5 còn dưới 3 quán AI mở cửa trên lối chơi hợp lý."
3. Thêm mục cuối **"## 16. Bổ sung khi lập kế hoạch"** gồm một câu dẫn ("Các điểm sau chốt những chỗ các mục trên để ngỏ; chúng có hiệu lực như phần còn lại của spec.") và bảng sau, chép nguyên văn:

| # | Mục | Chốt |
|---|---|---|
| 1 | 4, chỉnh giá giữa trưa | Ngưỡng tăng giá là 25% (giây 30) và 60% (giây 60), vì với nhịp 7s/ly quán AI chỉ bán tối đa 33% và 67% hàng ở hai mốc đó |
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

4. Commit spec và file kế hoạch này trong một commit `docs: Phố Trà Sữa design spec and implementation plan`.

**Xong khi:** `git show --stat HEAD` chỉ có hai file trên; `npm test` vẫn xanh.

---

## Giai đoạn 1: mô phỏng và cân bằng

Đọc trước: spec mục 3, 4, 6, 7, 14, 16; mục "Ràng buộc chung" và "Phụ lục: giao diện" của file này.

### Task 2: Nền sim — cấu hình test, rng, types, config

**File:** `vitest.config.ts`, `tsconfig.json`, `shared/sim/rng.ts` (+`.test.ts`), `shared/sim/types.ts`, `shared/sim/config.ts` (+`.test.ts`).

1. `vitest.config.ts`: `include` thành `['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/src/**/*.test.ts', 'scripts/**/*.test.ts']`, giữ `environment: 'node'`.
2. `tsconfig.json`: thêm `"scripts"` vào `include`. Nếu `scripts/bots.mjs` gây lỗi typecheck thì loại riêng nó (`exclude`), không sửa nó.
3. `rng.ts`: chép `mulberry32`, `shuffle` từ `server/game/random.ts` (không xoá file cũ); thêm `hashSeed(seed, key)` (FNV-1a 32-bit trên chuỗi `${seed >>> 0}|${key}`) và `stream(seed, key) = mulberry32(hashSeed(seed, key))`. Test: cùng khoá cùng dãy, khác khoá khác dãy, giá trị trong [0,1), `shuffle` không đổi mảng đầu vào.
4. `types.ts`: mọi kiểu ở Phụ lục. Được tinh chỉnh khi có lý do; ghi mọi thay đổi so với Phụ lục vào báo cáo.
5. `config.ts`: kiểu `SimConfig` và hằng `CONFIG` chứa **mọi con số** của spec mục 3, 4, 5, 6, 7 cùng mục 16 và mục "Những chỗ spec để ngỏ" ở trên: số khách và hệ số ngày, túi tiền, ngưỡng tin tưởng, phân bố size/topping, cửa sổ đến (750 nhịp), `enterLeadTicks` (15), kiên nhẫn (250 nhịp), hàng tối đa (5), độ dài trưa (900), trọng số điểm, phụ thu size/topping, ml theo size, giá và uy tín theo loại trà, giá topping, vốn, trần nợ, nâng cấp, bảng 6 quán AI (giá ngày đầu, giá vốn, uy tín, sức pha, nhịp/ly, ngày mở), ngưỡng chỉnh giá giữa trưa, luật nghỉ bán (+7k), tiền mặt bằng, thuế và mức chuyển thuế, trạm xe buýt, tin đồn (10 + 5/ngày ăn bớt, nhịp 450), cartel (36k, phạt 150k, −5, −8), các khoản uy tín, giá trị thương hiệu (8k/điểm), thời lượng từng bước pha (nhịp), nhân viên (90 nhịp), máy pha (nửa thời gian rót), bộ đệm (3), số tiền và hiệu ứng của 12 thẻ, lịch 5 ngày (chủ đề, giá trần, thuế, tin đồn, cartel cho phép).
6. `config.test.ts`: tổng sức pha 78 (ngày 1), 96 (ngày 2), 72 (ngày 3 có trần, 2 quán nghỉ); ly trung bình ~42 nhịp animation; thời gian rót khi có máy pha là số nguyên nhịp; mọi thời lượng là số nguyên.

**Xong khi:** test mới xanh, test cũ vẫn xanh, typecheck xanh.

### Task 3: Khách và chọn quán

**File:** `shared/sim/customers.ts`, `shared/sim/choice.ts` (+ test mỗi file).

- `customers.ts`: `customerCount`, `generateCustomers`, `generateAdCustomers` theo Phụ lục và mục "Những chỗ spec để ngỏ". Test: 130 khách ngày 1–4, 163 ngày 5; túi tiền và ngưỡng tin tưởng phủ đều (mỗi khoảng 5k có số khách gần bằng nhau); tỉ lệ size ~25/50/25 và L tăng theo túi tiền; số topping ~50/35/15, không lặp, trân châu nhiều nhất; `arriveTick < 750`; ngày 5 khoảng nửa số khách đến trước 450 là khách sợ, không ai sau 450; khách quảng cáo không làm đổi danh sách khách gốc; tất định theo seed.
- `choice.ts`: `score10`, `passesSkeptic`, `evaluate`, `staysAfterReprice`. Một quán được xét khi: đang mở, còn hàng cho đơn, uy tín hiệu dụng (uy tín − khoản trừ tin đồn) ≥ ngưỡng tin tưởng, chưa ghé, hàng < 5, qua phép thử đa nghi nếu quán đang giảm sâu, khớp `onlyShop`. Chọn điểm cao nhất > 0; hoà thì xoay theo `tie`. Mỗi quán có một lý do (`ShopVerdict`). Gán lý do: `closed`, `visited`, `outOfStock`, `lowTrust`, `steepDiscount`, `tooCrowded` (hàng ≥ 5, hoặc điểm ≤ 0 chỉ vì phần hàng dài), `tooExpensive` (điểm ≤ 0 ngay cả khi hàng trống), `otherBetter`, `chosen`. Khách sợ không chọn quán nào, lý do `rumor`.
- Test theo spec mục 14 phần "Khách" và từng lý do.

### Task 4: Quán AI

**File:** `shared/sim/shops.ts` (+test).

- `STREET` (thứ tự slot): hàng trên `batu, giare, cochap, luotsong`; hàng dưới `sinhvien, player, tapdoan`.
- `earned`, `clampAiPrice`, `restsToday`, `morningPrices`, `midRushPrice`, `aiProfit`, `applyExits` theo spec mục 4 "6 quán AI", "Chỉnh giá giữa trưa", "Nghỉ bán", "Rút lui", mục 16 điểm 1 và 12.
- `morningPrices` nhận lịch sử của người chơi (giá đóng cửa, số ly) vì "các quán khác" luôn gồm người chơi. Ngày 2 có cartel: cả 6 quán AI 36k (Tập Đoàn mở luôn ở 36k), `frozen` cả ngày. Ngày 4 cộng 3k chuyển thuế sau khi áp luật. Kẹp sau cùng.
- Test: giá ngày đầu; mỗi luật một test; kẹp; dưới trần 20k đúng Ông Cố Chấp và Sinh Viên nghỉ; sáng ngày 4 dùng giá ngày 2; sáng ngày 5 trừ 3k khỏi giá ngày 4; Sinh Viên đảo hướng; Lướt Sóng chép quán kiếm nhiều nhất (có thể là người chơi); Tập Đoàn mở ngày 2; lãi AI gồm tiền mặt bằng và ly thừa; ngày nghỉ −100k; đóng cửa sau 2 ngày lỗ liền, kể cả sau ngày 5; chỉnh giá giữa trưa ở 300 và 600 với hai ngưỡng.

### Task 5: Engine trưa — phố

**File:** `shared/sim/rush.ts` (+`rush.street.test.ts`).

- `createRush`, `step`, `advance` (nội bộ), `finishRush`, `summarizeRush` (phần phố), `counterView`. Tuân thủ thứ tự trong một nhịp và mục "Hiệu năng" ở trên.
- Phần phố: khách bước vào và tới nơi, chọn quán, vào hàng; quán AI phục vụ theo nhịp; hết hàng thì lật biển và hàng rời đi; kiên nhẫn 25 giây; chọn lại theo mục 16 điểm 5; tối đa 2 quán; quán AI chỉnh giá ở 300/600 và hàng của nó chấm lại điểm; mỗi khách kết thúc với đúng một `outcome`; đếm `eligible`, `emptyHanded`; phát đủ `SimEvent` ở Phụ lục.
- Quán người chơi trong task này đã nhận khách vào hàng (dùng `canServe` với kho), nhưng việc pha và giao làm ở Task 6. Khách trong hàng người chơi hết kiên nhẫn thì đếm `walkouts`.
- Test: đồng hồ và kết thúc ở 900; số khách không đổi khi có 4, 5 hay 6 quán AI mở; nhịp phục vụ 70/50 nhịp; hết hàng; hết kiên nhẫn rồi chọn lại một lần; khách đến ở nhịp 749 ra về lúc 900 không trừ uy tín; mỗi khách đúng một outcome; chuỗi sự kiện tất định; `step` không đổi đầu vào (đóng băng sâu).

### Task 6: Engine trưa — pha chế và giao hàng

**File:** `shared/sim/rush.ts` (+`rush.craft.test.ts`, `rush.serve.test.ts`).

- `craftInput`, `craftTick`, `checkInput`, `canDeliver`, `orderPrice`, `cupPrice`, `payment`, `canServe`, các hành động `craft`, `deliver`, `trash`, `closeEarly`.
- Theo spec mục 6 và mục 16 điểm 3, 4, 7: thứ tự bước; bấm trước tối đa 3; thời lượng (size 4, đá 8, trà S12/M16/L20, mỗi topping 6, giao 4 nhịp; máy pha: trà S6/M8/L10); trừ kho khi bước **bắt đầu**; chỉ giao cho 4 khách đầu, khi ly có trà và không còn animation; giao đúng nhận đủ tiền; giao sai thu 70% ly rẻ hơn làm tròn xuống và đếm `wrong`; thùng rác mất nguyên liệu đã dùng; ly giữ chỗ; kho đổi thì khách hết hàng cho đơn rời hàng không trừ uy tín; trà < 250 ml thì hết hàng; nhân viên; thuế 5k/ly ngày 4 (người chơi và AI); đóng cửa sớm; hết 90 giây bỏ ly dở.
- `craftInput`/`craftTick` nhận `stock: Stock | null`; `null` là ly thử ngày 1 (không trừ kho).
- Test theo spec mục 14 phần "Pha chế" và "Biên thời gian", gồm ví dụ 41k/31k → 21k và trường hợp ly thực nhận đắt hơn đơn gọi.

### Task 7: Engine trưa — đổi giá, ngày 5, tất định

**File:** `shared/sim/rush.ts` (+`rush.price.test.ts`, `rush.policy.test.ts`).

- Hành động `setPrice`: một lần; 10–50k; không vượt trần; phần trăm so với giá sáng, phép thử nguyên (`(new − morning)*100 > 20*morning` là chặt chém); chấm lại hàng theo mục 16 điểm 6; giảm quá 20% thì phép thử đa nghi cho hàng và cho khách đến sau; cờ phá cartel khi giá (sáng hoặc sau đổi) < 36k trong ngày cartel.
- Ngày 5: khách sợ đi ngang không mua (`outcome: 'scared'`); khoản trừ tạm (10 + 5 × ngày ăn bớt) cho quán chưa kiểm định — Chuỗi GiáRẻ tính 4 ngày, Chuỗi Tập Đoàn và Ông Cố Chấp miễn, người chơi miễn nếu đã tự kiểm định đạt; nhịp 450 phát `policy inspection`: quán < 2 ngày ăn bớt được gỡ khoản trừ và gắn `certified`, quán ≥ 2 ngày bị `named` và giữ khoản trừ.
- `summarizeRush` đầy đủ `RushResult`.
- **Chốt hình dạng `SimEvent`** sau task này; báo cáo ghi rõ danh sách sự kiện cuối cùng.
- Test theo spec mục 14 phần "Đổi giá" và "Chính sách" (phần trong trưa); cùng seed và cùng chuỗi hành động cho cùng trạng thái và cùng sự kiện.

### Task 8: Khởi tạo ván và thẻ

**File:** `shared/sim/run.ts` (chỉ `newRun`), `shared/sim/cards.ts` (+test mỗi file).

- `newRun(seed, runId)`: ngày 1, nhịp sáng, tiền 300, uy tín 50, 5 quán AI `active` + Tập Đoàn `notYet`, bộ thẻ phụ đã xáo, kế hoạch mặc định (giá 30k, trà chuẩn, nhập mức "vừa" — tạm tính bằng hằng số trong config, Task 9 thay bằng `quickFill`).
- `cards.ts`: `CARDS` (12 thẻ với nhân vật, 1–2 câu thoại tiếng Việt, nhãn hai lựa chọn, chỉ số bị ảnh hưởng) theo spec mục 7; `shuffleSideDeck`; `cardsForDay` (ngày 1–3: thẻ phụ rồi thẻ cốt truyện; ngày 4: thuế rồi kiểm định; ngày 5: phóng viên; thẻ phụ là thẻ đầu tiên chưa rút và hợp lệ trong bộ đã xáo, thẻ sinh viên không hợp lệ khi đã có nhân viên); `applyChoice` ghi cờ, tiền ngay, khoản uy tín buổi tối (`cardRep`) và hậu quả trễ (`pending`).
- Hậu quả cartel được chốt ở buổi tối ngày 2 (Task 10) dựa trên cờ; `applyChoice` chỉ ghi `flags.cartel`.
- Kiểm định tự trả: xét đạt/trượt ngay khi chọn (ngày ăn bớt tính tới ngày 4).
- Test: không lặp thẻ phụ; thẻ sinh viên bị bỏ khi đã có nhân viên; mỗi lựa chọn của mỗi thẻ cho đúng tiền, uy tín, cờ, hậu quả trễ.

### Task 9: Buổi sáng và mở cửa

**File:** `shared/sim/day.ts` (phần sáng), `shared/sim/run.ts` (`endRush`) (+test).

- `dayRules`, `planCost`, `validatePlan`, `quickFill`, `capacityEstimate`, `morningBrief`, `openDay`; `endRush(run, rush)` lưu `RushResult`, chuyển nhịp `cards`, gán `cards = cardsForDay(run)`.
- `quickFill`: ít ~10 ly, vừa ~15 ly, nhiều = sức pha hôm nay; trà và từng topping theo tỉ lệ đơn trung bình của config. `newRun` chuyển sang dùng `quickFill('mid')`.
- `openDay`: áp hậu quả trễ của sáng hôm nay (tiền, uy tín, nhân viên tạm, khách quảng cáo), trừ tiền nhập hàng và nâng cấp (băng rôn +10 ngay), đếm ngày ăn bớt (mục 16 điểm 9), tính giá sáng của quán AI (`morningPrices`), mở Tập Đoàn ngày 2, tạo `RushState`. Tiền đã ở trần nợ thì vẫn mở cửa được với hàng bằng 0.
- `MorningBrief` (định nghĩa ở task này): chủ đề và luật hôm nay, hậu quả trễ vừa áp, bảng giá đóng cửa hôm qua của phố (ai bán hết, ai ế, ai mới mở, ai đóng cửa), dòng gợi ý dùng hàng hôm qua, sức pha, dòng trạm xe buýt ngày 5 ("không có trạm: X khách, có trạm: Y khách").
- Test: chi phí; trần nợ −150k; mở cửa với hàng 0 khi đã ở trần; một nâng cấp mỗi sáng, không mua lại; `quickFill` ba mức; hậu quả trễ áp đúng sáng.

### Task 10: Buổi tối, chuyển ngày, điểm

**File:** `shared/sim/day.ts` (`closeDay`), `shared/sim/run.ts` (`chooseCard`, `nextDay`, `score`, `ending`) (+test, gồm `run.integration.test.ts`).

- `chooseCard`: áp lựa chọn, sang thẻ kế; thẻ cuối thì gọi `closeDay` và chuyển nhịp `report`.
- `closeDay`: lãi ngày (mục "Những chỗ spec để ngỏ"), giá trị nguyên liệu bỏ đi, lãi và đóng cửa của quán AI (`aiProfit`, `applyExits`), hậu quả cartel tối ngày 2, khoản uy tín buổi tối (loại trà, giao sai, bỏ về, chặt chém, phục vụ sạch, thẻ) cộng rồi kẹp, xét thua, `DaySummary`, `DayReport` gồm `lesson { id, data }` với biến thể theo lựa chọn (ngày 2: từ chối / giữ lời / phá) và số liệu thật (ví dụ dải giá sáng và cuối trưa ngày 1).
- `nextDay`: ngày kế buổi sáng, hoặc `end` sau ngày 5 hay khi thua. `score`: lãi + uy tín × 8k. `ending`: kết cục, quán đã đóng, những việc làm mất uy tín, nhãn lựa chọn, lãi theo ngày.
- Test: từng khoản uy tín ở hai thời điểm; kẹp; phục vụ sạch cần ≥1 ly; về 0 thì thua kể cả tối ngày 5; khoản trừ tin đồn không gây thua; ba kết cục cartel; phạt vẫn trừ khi tiền âm; một ván đầy đủ qua `JSON.parse(JSON.stringify())` ở mọi nhịp; điểm.

### Task 11: Bot tự chơi

**File:** `shared/sim/autoplay.ts` (+test).

- `RushPolicy`, `Strategy`, `BotState`, `botStep`, `playRush` (có ghi khung sự kiện khi `record`), `playRun`, `STRATEGIES`, `storyCombos` theo Phụ lục.
- Lối chơi (spec mục 14): `reasonable` (giá theo phố, trà chuẩn, nhập vừa sức, phục vụ khách sắp hết kiên nhẫn trước, mua máy pha sớm), `flat15`, `flat45`, `skimp`, `premium`, `double`, `half`, `plainS` (giao ly S không topping cho mọi khách), `day5cheat` (trung thực ngày 1–4, tự kiểm định, ngày 5 ăn bớt và tăng giá), `delay1` (0,1 giây mỗi thao tác), `delay6` (0,6 giây). Mặc định độ trễ thao tác của `reasonable` là 0,3 giây.
- `storyCombos`: 3 kết cục cartel (từ chối, đồng ý giữ lời, đồng ý phá) × 2⁴ lựa chọn của các thẻ cốt truyện còn lại = 48 lối chơi.
- Test: `botStep` theo đúng độ trễ và tỉ lệ sai; `playRun` xong với mọi lối chơi trên 3 seed và tất định; khách gốc giống nhau giữa các lối chơi; một ván dưới 100 ms (đo, ghi vào báo cáo; không làm test thất bại vì máy chậm).

### Task 12: Bộ giả lập cân bằng

**File:** `scripts/balance.ts`, `scripts/balance-checks.ts` (+`balance-checks.test.ts`), `package.json` (thêm `"balance": "tsx scripts/balance.ts"`).

- `balance-checks.ts`: hàm thuần nhận kết quả các lối chơi trên các seed, trả về danh sách điều kiện (id, đạt/trượt, giá trị đo, ngưỡng, seed tệ nhất). Điều kiện là toàn bộ danh sách "Giả lập báo lỗi khi" ở spec mục 14 (gồm dòng thêm ở Task 1), cách tính theo mục 16 điểm 16.
- `balance.ts`: CLI `--seeds N` (mặc định chọn sao cho chạy dưới 60 giây), `--from S`, `--check ID`, `--json`. In mỗi điều kiện một dòng. Thoát 0 nếu tất cả đạt, 1 nếu có điều kiện trượt, 2 nếu sai tham số hoặc sim ném lỗi.
- Test của phần kiểm tra dùng kết quả dựng tay, mỗi điều kiện có một ca đạt và một ca trượt.
- Task này **không** chỉnh số; trượt là bình thường. Ghi kết quả chạy đầu tiên vào báo cáo.

### Task 13: Chỉnh số cân bằng

**File:** `shared/sim/config.ts`, bảng số trong spec (mục 4, 6, 7) nếu số đổi; test có giá trị cứng phụ thuộc số đã đổi.

- Chỉ đổi giá trị trong `config.ts` cho tới khi `npm run balance` thoát 0. Không đổi luật, không đổi code sim. Nếu một điều kiện không thể đạt chỉ bằng số, dừng lại, báo `BLOCKED` kèm phân tích (điều kiện nào, vì sao, đề xuất đổi luật nào).
- Ưu tiên giữ các con số người chơi nhìn thấy trong spec; ghi mọi thay đổi (cũ → mới, lý do) vào báo cáo và cập nhật bảng tương ứng trong spec.
- Rủi ro đã biết: ăn bớt ngày cuối có thể vẫn lời; giá ngày 2 có thể không tụt đủ 3k; cartel có ba ràng buộc cùng lúc; ngày giá trần làm nhiều quán AI lỗ.

### Task 30: Quán cũ phản ứng khi có quán mới (đổi luật)

Thêm sau Task 13 theo quyết định của người dùng (2026-11-20): để đạt B5, Task 13 phải đặt giá ngày đầu rất cao, làm ngày thường có tỉ lệ khách về tay không ngang ngày giá trần. Người dùng chọn đổi luật thay vì nới điều kiện.

**File:** spec (mục 4 "6 quán AI", mục 14, mục 16), `shared/sim/config.ts` (tham số mới), `shared/sim/shops.ts` (+test), `scripts/balance-checks.ts` (+test), `scripts/balance.ts`; sửa các chú thích còn ghi số cũ (`shops.ts:149`, `day.ts:369`, `autoplay.ts:343`).

1. **Luật mới (spec mục 4, sau bảng 6 quán AI):** "**Phản ứng khi có quán mới.** Sáng ngày một quán AI khai trương, mọi quán AI đang mở trừ Ông Cố Chấp đặt giá không cao hơn giá khai trương của quán mới cộng 2k, sau khi áp luật riêng của mình. Khách bị chia: quán nào giữ giá cao sẽ mất khách sang quán mới." Khoảng 2k và danh sách quán không phản ứng nằm trong config. Người chơi không bị ép.
2. `morningPrices` áp luật này rồi mới kẹp giá. Test: ngày 2 không cartel, mỗi quán cũ (trừ Cố Chấp) có giá ≤ giá Tập Đoàn + 2k; ngày có cartel không áp (giá cartel 36k thắng); các ngày khác không đổi.
3. **Hai điều kiện cân bằng mới (spec mục 14, danh sách "Giả lập báo lỗi khi"):**
   - B13: "Trên lối chơi hợp lý, tỉ lệ khách về tay không ngày giá trần thấp hơn 2 lần trung bình của ngày 1 và ngày 2."
   - B14: "Việc Chuỗi Tập Đoàn mở cửa làm giá đóng cửa trung bình của phố ngày 2 giảm dưới 2k so với chạy đối chứng không có quán mới." Chạy đối chứng: cùng seed, lối chơi hợp lý, config với Tập Đoàn không bao giờ mở (`firstDay` quá ngày 5); so theo cặp seed.
4. Mục 16 thêm một dòng ghi quyết định này.
5. Không chỉnh các con số khác (Task 31 làm). `npm run balance` có thể trượt; ghi kết quả vào báo cáo.

### Task 31: Chỉnh số lại sau khi đổi luật

**File:** như Task 13.

- Như Task 13: chỉ đổi giá trị trong `config.ts` (cùng bảng spec và test ghim số) cho tới khi `npm run balance` thoát 0 với mọi điều kiện, gồm B13 và B14.
- Đưa giá ngày đầu của quán AI về gần mức ban đầu của spec (khoảng 22–34k) thay vì 36–40k.
- Biên an toàn: với `--seeds 100` trên ba dải seed khác nhau (ví dụ từ 1, 1000, 5000), không điều kiện nào nằm trong 5% sát ngưỡng; riêng B8c nên dưới 130.
- Băng rôn không được thành điểm miễn phí: giá trị thương hiệu của +10 uy tín phải thấp hơn giá băng rôn.

**Xong giai đoạn 1 khi:** `npm test`, `npm run typecheck`, `npm run balance` đều qua.

---

## Giai đoạn 2: cảnh phố và hình vẽ

Đọc trước: spec mục 9 (toàn bộ), mục 6 "Hai lớp giao diện"; `shared/sim/types.ts` (`SimEvent`), `shared/sim/autoplay.ts` (`playRush`). Hình vẽ bằng Canvas 2D tự viết, không thư viện vẽ ngoài. Màu lấy từ `web/src/styles/tokens.css`.

**Chất lượng hình ảnh là yêu cầu hàng đầu của sản phẩm.** Mỗi task hình ảnh nộp kèm ảnh chụp (bằng `scripts/shoot.ts` từ Task 14) ở cả màn dọc (390×844) và ngang (844×390) vào `.shots/task-<N>/`, và liệt kê chúng trong báo cáo. Reviewer sẽ xem ảnh.

### Task 14: Nền cảnh phố, trang xem thử, công cụ chụp

**File:** `web/src/scene/layout.ts`, `tween.ts`, `Scene.ts`, `director.ts` (+`director.test.ts`), `draw/placeholder.ts`, `StreetCanvas.tsx`; `web/src/pages/Dev/ScenePreview.tsx`; `web/src/main.tsx` (route chỉ có ở dev); `scripts/shoot.ts`; `package.json` (devDependency `puppeteer-core`, script `"shoot": "tsx scripts/shoot.ts"`).

- `layout.ts`: 7 slot (4 trên, 3 dưới, người chơi giữa hàng dưới), điểm xếp hàng, lối vào hai đầu, trạm xe buýt; hai bộ toạ độ dọc và ngang theo đơn vị logic, co giãn theo khung.
- `tween.ts`: nội suy và các hàm easing (gồm lò xo).
- `director.ts` (logic thuần, có test): nhận `SimEvent` theo nhịp, dựng hàng lệnh cho từng nhân vật (đi tới, nhìn bảng giá, vào hàng, nhích hàng, được phục vụ và đi ra, bỏ đi, chọn lại, rời phố), trạng thái quán, đạo cụ theo sự kiện chính sách. Nhân vật trễ hơn sim quá 15 nhịp thì nhảy tới vị trí đúng. Quá 40 nhân vật thì bỏ bớt khách đang rời phố không liên quan người chơi, gộp hàng dài thành "+n". Có `reset(snapshot)` dựng lại toàn bộ từ `RushState`.
- `Scene.ts`: canvas, mật độ điểm ảnh tối đa 2, vòng `requestAnimationFrame`, dừng khi tab ẩn, sắp lớp theo chiều sâu, công tắc giảm chuyển động, đo khung hình (`window.__sceneFps` ở dev).
- `draw/placeholder.ts`: hình tạm (khối đơn giản) cho khách và quán; Task 15–16 thay thế.
- `StreetCanvas.tsx`: bọc React, chế độ `live` (nhận sự kiện) và `ambient` (để Task 17 làm), co giãn theo khung cha.
- `ScenePreview.tsx` ở `/dev/scene` (chỉ khi `import.meta.env.DEV`): chọn ngày, seed, lối chơi, tốc độ phát; phát lại một trưa do `playRush(..., record = true)` tạo; hiện số khung hình.
- `scripts/shoot.ts`: tự khởi động Vite dev server bằng API (`createServer`, root `web`, cổng tự chọn), mở Chrome bằng `puppeteer-core` (đường dẫn từ `CHROME_PATH`, mặc định `C:\Program Files\Google\Chrome\Application\chrome.exe`), vào route, chờ, chụp `--frames N --every ms` ảnh PNG vào `--out` (trong `.shots/`), viewport `--size WxH`, in lỗi console và số khung hình đo được, rồi tắt mọi thứ.
- Test: `director` (khách vào hàng đúng quán và đúng vị trí; phục vụ thì đi ra; chọn lại; bắt kịp khi trễ; giới hạn 40; `reset`).

### Task 15: Nhân vật khách

**File:** `web/src/scene/rig.ts`, `web/src/scene/draw/characters.ts`, `web/src/scene/draw/faces.ts` (nếu cần); nối vào `Scene.ts`/`director.ts`.

- Khung khớp (đầu, thân, tay, chân), trộn tư thế; khách dựng từ `look` thành hàng chục kiểu (học sinh, dân văn phòng, shipper, cụ ông, bà nội trợ, KOL…) qua dáng người, tóc, màu da, trang phục, phụ kiện.
- Chuyển động theo spec mục 9 "Nhân vật khách": đi, đứng thở, nhìn điện thoại, ngẩng nhìn bảng giá, nhích hàng, vui (nhảy nhẹ, tim bay), sốt ruột (gõ chân), bực bỏ đi (dậm chân), vừa đi vừa uống; biểu cảm khuôn mặt.
- Phong cách phẳng, bo tròn, nét mềm theo spec mục 9 "Phong cách". Không dùng ảnh.
- Nộp ảnh chụp từng kiểu nhân vật và từng chuyển động (dải khung hình).

### Task 16: Quán, đạo cụ, ánh sáng, hạt

**File:** `web/src/scene/draw/shops.ts`, `draw/props.ts`, `particles.ts`, `lighting.ts`, `draw/street.ts` (nền đường, vỉa hè, cây); nối vào `Scene.ts`/`director.ts`.

- 7 quán có cá tính và các trạng thái theo spec mục 9 "7 quán có cá tính riêng" và "Trạng thái quán" (mở, hết hàng lật biển, nghỉ bán kéo cửa cuốn, đóng hẳn treo biển sang nhượng, khai trương bóng bay, bảng giá lật số, đồng xu nảy, chủ quán ngáp/lau mồ hôi, huy hiệu "Đã kiểm định"). Hình tĩnh của quán vẽ sẵn vào canvas phụ theo tỉ lệ.
- "Không khí phố" và "Đạo cụ theo ngày" theo spec mục 9: ánh sáng theo nhịp trong ngày, cây đung đưa, xe máy chạy ngang, mèo; ngày 2 khai trương; ngày 3 loa phường, biển "GIÁ TRẦN 20K"; ngày 4 cán bộ thuế, công trường trạm xe buýt; ngày 5 xe loa công bố ở giây 45, huy hiệu, xe buýt ghé trạm.
- Hạt: đồng xu, tim, pháo giấy.
- Nộp ảnh chụp 7 quán ở mỗi trạng thái và mỗi ngày.

### Task 17: Bong bóng lời nói, chế độ nền, hiệu năng

**File:** `web/src/scene/bubbles.ts` (+test cho phần chọn câu), `web/src/scene/ambient.ts`, `web/src/scene/StreetList.tsx`; nối vào `StreetCanvas.tsx`.

- Bong bóng theo bảng ở spec mục 9: 3–4 câu cho mỗi tình huống, lấy theo lý do thật trong `customerConsider`/`customerAbandon`/`customerServed`/`customerLeave`/`shopPrice`/chính sách; tối đa 3 bong bóng cùng lúc, ưu tiên khách liên quan quán người chơi; chọn câu bằng `scene/{day}`. Phần chọn câu và ưu tiên là logic thuần có test.
- `ambient.ts`: khách đi dạo giả cho các màn nền (màn tiêu đề, chờ, sáng, tối).
- `StreetList.tsx`: dải phố dạng danh sách khi canvas không khởi tạo được (spec mục 13).
- Hiệu năng: ngày 3 ở trang xem thử giữ ≥ 55 khung/giây trên máy dev với CPU bị làm chậm 4× trong Chrome (`shoot.ts` có tuỳ chọn `--cpu 4`); ghi số đo vào báo cáo.

---

## Giai đoạn 3: các màn chơi

Đọc trước: spec mục 5, 6, 7, 8, 9 (phần "Bảng pha chế", "Các màn khác", "Bố cục"), 10 "Lưu ván", 13. UI dùng React + Framer Motion + CSS như hiện có (`web/src/ui/`, `web/src/styles/`). Mỗi task giao diện nộp ảnh chụp ba bố cục (390×844, 844×390, 1440×900) vào `.shots/task-<N>/`.

### Task 18: Kho lưu, lưu ván, đồng hồ

**File:** `web/src/game/storage.ts`, `web/src/game/runStore.ts` (+test), `web/src/game/useRun.ts`, `web/src/game/format.ts`, `web/src/net/socket.ts` (chỉ đổi `storage` thành re-export từ `game/storage.ts`).

- `storage.ts`: kho khoá–giá trị trên `localStorage` có try/catch, và kiểu `KeyValueStore` để tiêm vào test.
- `runStore.ts`: reducer thuần trên `{ run, rush, planDraft }` cho mọi hành động của người chơi, và `save`/`load(store, key, sessionCode?)`. Lưu ở mỗi lần chuyển nhịp; lưu khi đang trưa thì ghi trạng thái buổi sáng của ngày đó kèm kế hoạch, chưa trừ tiền. Khoá `pts.solo.run`, `pts.class.{code}.run`, `pts.solo.best`. Mã buổi đổi thì bỏ ván.
- `useRun.ts`: đồng hồ duy nhất; dồn thời gian thực thành nhịp 100 ms (bắt kịp tối đa vài nhịp), dừng khi tab ẩn, xếp hành động UI cho nhịp kế, công khai trạng thái qua `useSyncExternalStore`, đẩy sự kiện sang cảnh phố qua ref.
- `format.ts`: thêm định dạng mới (tiền nghìn đồng, phần trăm, giây); giữ các export cũ cho tới Task 24.
- Test `runStore`: khôi phục đúng ở từng nhịp; tải lại giữa trưa quay về sáng, chưa trừ tiền; mã buổi đổi thì bỏ ván; kho hỏng vẫn chơi được.

### Task 19: Khung game và buổi sáng

**File:** `web/src/pages/Game/Game.tsx`, `DayTitle.tsx`, `MorningScreen.tsx`, `game.css`; `web/src/pages/Dev/GamePreview.tsx` + route dev `/dev/game?seed=&day=&phase=&strategy=` (bot tự chơi tới đúng nhịp đó rồi giao quyền).

- `Game`: nhận `mode: 'solo' | 'class'`, seed, runId, callback kết quả ngày; chuyển nhịp có hiệu ứng; nền là `StreetCanvas` (ambient ở sáng/tối, live ở trưa); ba bố cục theo spec mục 9 "Bố cục"; khung trọn chiều cao, không cuộn trang (`100dvh`, `overscroll-behavior: none`); đổi bố cục khi xoay máy mà giữ trạng thái.
- `DayTitle`: thẻ tiêu đề kiểu điện ảnh trượt trên cảnh phố đổi ánh sáng.
- `MorningScreen`: mọi mục ở spec mục 5; kệ hàng đầy dần khi tăng trà và topping; xe giao hàng tới khi bấm Mở cửa.

### Task 20: Màn trưa và bảng pha chế

**File:** `web/src/pages/Game/RushScreen.tsx`, `CraftPanel.tsx`, `Cup.tsx`, `CounterCustomer.tsx`, `rush.css`.

- Theo spec mục 6 "Hai lớp giao diện", "Pha một ly", "Quầy", "Đổi giá giữa trưa" và mục 9 "Bảng pha chế": lớp phủ mở/đóng theo bố cục; thanh nhỏ khi đóng; 4 chân dung khách với bong bóng đơn và thanh kiên nhẫn đổi biểu cảm; nút sáng theo `checkInput`; ly với đá rơi từng viên, trà rót có sóng sánh và màu theo loại trà, topping rơi nảy, nắp và ống hút; kéo ly bằng Pointer Events (`setPointerCapture`, `touch-action: none`) nghiêng theo quán tính, và cách chạm ly rồi chạm khách; thả đúng thì tiền bay về ô tiền, thả sai hiện số tiền bị cắt màu đỏ; thùng rác; nhân viên ở quầy bên; HUD đồng hồ, tiền, uy tín, kho; đổi giá một lần; đóng cửa sớm; ly thử ngày 1 có tô sáng nút kế tiếp.

### Task 21: Thẻ, báo cáo, màn kết

**File:** `web/src/pages/Game/CardScreen.tsx`, `ReportScreen.tsx`, `EndScreen.tsx`, `lessons.ts`.

- `CardScreen`: thẻ chia ra, nhân vật chớp mắt và có cử chỉ, vuốt nghiêng theo tay rồi bay đi; hiện biểu tượng chỉ số bị ảnh hưởng, không hiện con số.
- `ReportScreen`: mọi mục ở spec mục 8; số chạy lên, cột dựng dần, đường giá của từng quán vẽ ra, uy tín đổi từng nấc với lý do; thẻ bài học lấy chữ từ `lessons.ts` (theo `lesson.id`, chèn `lesson.data`) với văn bản spec mục 3; hạng ở chế độ lớp học (prop tuỳ chọn).
- `EndScreen`: đoạn kết hồi phục hoặc "Mất hết lòng tin" (cửa cuốn kéo xuống), điểm và biểu đồ lãi theo ngày, tóm tắt lựa chọn và bài học, pháo giấy khi xong ván; thẻ phóng viên cho người thua sớm; solo: kỷ lục và chơi lại.

### Task 22: Chế độ solo, gỡ slide

**File:** `web/src/pages/Solo/Solo.tsx`, `web/src/main.tsx`, `server/app.ts` (phục vụ `/solo`), `server/app.test.ts`; xoá `web/src/pages/Presentation/`, `web/src/content/`, `web/public/img/`.

- `/` và `/solo` vào Solo: màn tiêu đề trên cảnh phố nền, nút chơi, kỷ lục; seed ngẫu nhiên mỗi ván; tiếp tục ván dở nếu có.
- Solo và mọi thứ nó import không được import `web/src/net/socket.ts`. Kiểm bằng cách build rồi grep chunk của Solo, và bằng `shoot.ts` ghi nhận không có request `/socket.io`.
- Test server: `GET /solo` trả về trang.

---

## Giai đoạn 4: lớp học

Đọc trước: spec mục 2, 11, 13; mục 16 điểm 15; code hiện có `server/app.ts`, `server/app.test.ts`, `web/src/pages/Play/Play.tsx`, `JoinScreen.tsx`, `web/src/pages/Host/Host.tsx`, `HostControls.tsx` (giữ luồng vào buổi, khôi phục token, host key).

### Task 23: Giao thức, buổi học, giải, lưu file

**File:** `shared/protocol.ts` (+test), `server/awards.ts` (+test), `server/session.ts` (+test), `server/sessionFile.ts` (+test). Chưa nối vào app.

- `protocol.ts`: giới hạn tên (20 ký tự) và số người (200), `SessionPhase`, `Vote`, `SessionSnapshot` (trạng thái, mã buổi, seed, số người, giải, top 5, hạng mọi người khi trao giải), `HostBoard`, `ClientToServer`/`ServerToClient` theo spec mục 11, `parseDaySummary(unknown)` kiểm kiểu và khoảng giá trị.
- `awards.ts`: 4 giải và luật hoà theo spec mục 11 "Giải".
- `session.ts`: lớp `Session` (tiêm `now`, `random`, `persist`): vào buổi, khôi phục, bình chọn trước/sau, tiến độ, `submitDay` (chỉ mã ván đầu, chỉ ngày kế, bỏ trùng; trả hạng trong số người đã xong ngày đó), mở chợ, trao giải (chốt), reset (seed và mã mới, giữ tên người đang kết nối), `snapshot()`, `board()`, `toJSON`/`fromJSON`.
- `sessionFile.ts`: nạp lúc khởi động (file hỏng thì ghi log, bắt đầu mới), ghi nguyên tử có trễ (file tạm rồi đổi tên), lỗi ghi thì ghi log và giữ trong RAM. Đường dẫn từ `SESSION_FILE`; thêm file mặc định vào `.gitignore`.

### Task 24: Nối server mới, hàng đợi gửi, gỡ game cũ

**File:** `server/app.ts`, `server/app.test.ts`, `server/index.ts`, `web/src/game/reportQueue.ts` (+test), `web/src/net/socket.ts`; xoá `server/game/`, `shared/config.ts`, `shared/types.ts`, các export cũ trong `web/src/game/format.ts`, các màn Play và Host cũ (thay bằng trang tạm biên dịch được, Task 25–26 làm thật).

- `app.ts`: thay `GameRoom` bằng `Session`; giữ gộp phát, phòng `hosts`, đánh dấu mất kết nối, `/healthz`, `/api/config`; `host:board` chỉ gửi socket đã xác thực; phục vụ `/`, `/solo`, `/play`, `/host`. `index.ts`: nạp và ghi file buổi.
- `reportQueue.ts`: hàng đợi thuần (`enqueue`, `next`, `ack`, `serialize`, `restore`): đúng thứ tự, không trùng, sống qua lần tải lại; chứa cả `DaySummary` lẫn bình chọn sau.
- `socket.ts`: viết lại thành `connect()` chỉ Play và Host gọi; không còn socket tạo lúc nạp module. Giữ: kết nối lại khi tab hiện lại, dự phòng long-polling, timeout ack 5 giây, `usePlayUrl`, `useNow`.
- Test server: vào buổi, khôi phục, bình chọn, mở chợ, gửi ngày theo thứ tự, bỏ trùng và mã ván khác, xếp hạng theo ngày, giải, reset đổi mã buổi, bảng host chỉ tới socket đã xác thực, ghi và nạp lại file buổi.

### Task 25: Màn người chơi lớp học

**File:** `web/src/pages/Play/Play.tsx`, `JoinScreen.tsx`, `LobbyScreen.tsx`, `play.css`.

- Vào buổi, khôi phục token (khoá `pts.token`), bình chọn trước (khoá `pts.vote`), màn chờ trên cảnh phố nền, chạy `Game` ở chế độ lớp học với seed của buổi khi chợ mở, gửi kết quả qua `reportQueue`, hạng sau mỗi ngày, màn trao giải (hạng của mình, giải), buổi đã kết thúc thì mời chơi solo, chơi lại chuyển sang `/solo`, huy hiệu mất kết nối.

### Task 26: Màn host

**File:** `web/src/pages/Host/Host.tsx`, `ProjectorView.tsx`, `BoardView.tsx`, `AwardsView.tsx`, `HostControls.tsx`, `host.css`.

- Giữ luồng host key hiện có (đọc từ URL, lưu, xoá khỏi thanh địa chỉ, thử lại khi mạng chậm). Hai chế độ xem theo spec mục 11 "Màn host": màn chiếu (QR, số người; cảnh phố nền khi chợ mở; giải) và bảng theo dõi (dải tổng quan, bảng thành viên, nhãn lựa chọn, chi tiết từng ngày). Nút Mở chợ, Trao giải, Reset có hộp xác nhận.

### Task 27: Bot tổng duyệt

**File:** `scripts/bots.ts`, `package.json` (`"bots": "tsx scripts/bots.ts"`); xoá `scripts/bots.mjs`.

- `npm run bots -- N`: N bot vào buổi, bình chọn, chờ chợ mở, chạy `playRun` trên seed của buổi với lối chơi ngẫu nhiên trong `STRATEGIES`, gửi từng ngày có trễ ngẫu nhiên, gửi bình chọn sau. Đọc `BOT_URL`, `HOST_KEY`. Có lệnh `open`, `awards`, `reset` cho host.

---

## Giai đoạn 5: dọn dẹp và tài liệu

### Task 28: Dọn dẹp và đổi tên

- Xoá component không còn ai dùng (grep trước khi xoá; dự kiến `Countdown`, `Slider`, `Select`, `Hands`) cùng CSS của chúng; luật `.deck` chỉ còn nếu host dùng.
- Xoá `docs/huong-dan-thuyet-trinh.md`, spec và plan ngày 2026-11-14.
- Đổi tên cũ theo spec mục 12: `web/index.html` (tiêu đề "Phố Trà Sữa", mô tả), `server/index.ts` (log, mã host mặc định `pho-tra-sua`), mọi khoá `hbt.*`, mọi chỗ còn "Hai Bàn Tay" hay "Chợ Trà Sữa Hỗn Loạn" (trừ trong lịch sử git).
- `npm run build` chạy được.

### Task 29: Tài liệu

- Viết lại `README.md` chỉ nói về game: ba chế độ, chạy máy, deploy, biến môi trường (gồm `SESSION_FILE`), bot, kiểm thử, giả lập cân bằng, công cụ chụp.
- Tạo `docs/huong-dan-host.md`: cách chạy một buổi lớp học từng bước, sự cố thường gặp; ghi rõ file buổi sống qua lần khởi động lại tiến trình nhưng không qua lần deploy lại container.

---

## Phụ lục: giao diện của `shared/sim`

Đây là hợp đồng khởi điểm. Task 2 viết nó thành `types.ts`; các task sau được tinh chỉnh khi có lý do và phải ghi lại trong báo cáo.

```ts
// types.ts
export type K = number; export type Tick = number; export type Ml = number;
export type Day = 1 | 2 | 3 | 4 | 5;
export type Phase = 'morning' | 'rush' | 'cards' | 'report' | 'end';
export type Size = 'S' | 'M' | 'L';
export type ToppingId = 'pearl' | 'jelly' | 'pudding';
export type TeaGrade = 'skimp' | 'standard' | 'premium';
export type UpgradeId = 'staff' | 'machine' | 'banner';
export type AiShopId = 'batu' | 'giare' | 'cochap' | 'luotsong' | 'sinhvien' | 'tapdoan';
export type ShopId = 'player' | AiShopId;
export type StoryCardId = 'cartel' | 'shockTopping' | 'blackMarket' | 'tax' | 'inspection' | 'reporter';
export type SideCardId = 'kol' | 'tab' | 'student' | 'complaint' | 'deliveryAd' | 'scholarship';
export type CardId = StoryCardId | SideCardId;
export type Choice = 'A' | 'B';

export interface Order { size: Size; toppings: ToppingId[] }   // 1..3 loại khác nhau, thứ tự chuẩn
export interface Stock { teaMl: Ml; toppings: Record<ToppingId, number> }

export interface Customer {            // bất biến trong ngày; chỉ số trong RushState.customers === id
  id: number; budget: K; trust: number; skeptic: number;   // skeptic: 0..1000
  order: Order; arriveTick: Tick; entry: 'left' | 'right' | 'bus';
  tie: number; look: number; scared: boolean; onlyShop: ShopId | null;
}
export type CustomerOutcome = 'served' | 'servedWrong' | 'noOffer' | 'gaveUp' | 'rushEnd' | 'scared';
export interface CustomerRt { status: 'pending' | 'queued' | 'done'; shop: ShopId | null;
  joinedTick: Tick; visited: ShopId[]; outcome: CustomerOutcome | null }

export type ShopStatus = 'open' | 'soldOut' | 'resting' | 'closed' | 'notYet' | 'closedEarly';
export interface RushShop {
  id: ShopId; slot: number; status: ShopStatus; grandOpening: boolean;
  price: K; openPrice: K; trail: [Tick, K][];
  rep: number; rumorPenalty: number; certified: boolean; named: boolean;
  queue: number[]; sold: number;
  ai: null | { cost: K; capacity: number; cupsLeft: number; ticksPerCup: Tick; busy: Tick; frozen: boolean };
}

export type CraftInput = { k: 'size'; size: Size } | { k: 'ice' } | { k: 'tea' } | { k: 'topping'; id: ToppingId };
export interface Cup { size: Size; iced: boolean; teaMl: Ml; toppings: ToppingId[] }
export interface CraftState { cup: Cup | null;
  anim: { step: CraftInput['k'] | 'deliver'; endsAt: Tick } | null;
  buffer: CraftInput[] }                // tối đa 3

export interface RushPlayer {
  morningPrice: K; priceChanged: boolean; gouged: boolean; dropPermille: number; brokeCartel: boolean;
  tea: TeaGrade; machine: boolean; stock: Stock; bought: Stock; craft: CraftState;
  staff: null | { progress: Tick };
  tally: { revenue: K; tax: K; cups: number; wrong: number; staffCups: number;
           walkouts: number; missedNoStock: number; trashed: number };
}
export interface DayRules { day: Day; ceiling: K | null; taxPerCup: K; rumor: boolean; cartel: boolean; customerFactor: number }
export interface RushState {
  day: Day; tick: Tick; done: boolean; rules: DayRules;
  customers: Customer[]; rt: CustomerRt[];
  arrivalOrder: number[]; nextArrival: number; nextEnter: number;
  shops: RushShop[]; player: RushPlayer;
  street: { eligible: number; emptyHanded: number; taxFund: K };
}

export type Action =
  | { type: 'craft'; input: CraftInput } | { type: 'deliver'; customer: number }
  | { type: 'trash' } | { type: 'setPrice'; price: K } | { type: 'closeEarly' };

export type RejectReason = 'tooExpensive' | 'tooCrowded' | 'lowTrust' | 'outOfStock'
  | 'steepDiscount' | 'otherBetter' | 'closed' | 'visited' | 'rumor';
export interface ShopVerdict { shop: ShopId; score10: number | null; reason: RejectReason | 'chosen' }
export type LeaveCause = 'patience' | 'priceUp' | 'steepDiscount' | 'stockOut' | 'shopClosed';
export type InputReject = 'order' | 'bufferFull' | 'noTea' | 'noTopping' | 'duplicate' | 'busy'
  | 'noCup' | 'notInFirstFour' | 'priceUsed' | 'priceRange' | 'ceiling';

export type SimEvent = { t: Tick } & (
  | { type: 'rushStart'; day: Day; rules: DayRules }
  | { type: 'customerEnter'; customer: number; entry: Customer['entry'] }
  | { type: 'customerConsider'; customer: number; reshop: boolean; verdicts: ShopVerdict[]; chosen: ShopId | null }
  | { type: 'customerJoin'; customer: number; shop: ShopId; position: number }
  | { type: 'customerServed'; customer: number; shop: ShopId; by: 'player' | 'staff' | 'ai'; correct: boolean; paid: K; full: K }
  | { type: 'customerAbandon'; customer: number; shop: ShopId; cause: LeaveCause; repHit: boolean }
  | { type: 'customerLeave'; customer: number; outcome: CustomerOutcome; emptyHanded: boolean }
  | { type: 'shopPrice'; shop: ShopId; from: K; to: K }
  | { type: 'shopStatus'; shop: ShopId; status: ShopStatus }
  | { type: 'policy'; kind: 'inspection'; certified: ShopId[]; named: ShopId[] }
  | { type: 'policy'; kind: 'rumorLifted' }
  | { type: 'craftStep'; step: CraftInput['k'] | 'deliver'; endsAt: Tick }
  | { type: 'cupTrashed' }
  | { type: 'inputRejected'; action: Action['type']; why: InputReject }
  | { type: 'rushEnd'; early: boolean });

export interface MorningPlan { price: K; tea: TeaGrade; teaMl: Ml; toppings: Record<ToppingId, number>; upgrade: UpgradeId | null }
export type PlanIssue = 'price' | 'ceiling' | 'teaStep' | 'credit' | 'upgradeOwned' | 'negative';
export interface ShopDayResult { id: ShopId; status: ShopStatus; openPrice: K | null; closePrice: K | null;
  trail: [Tick, K][]; sold: number; capacity: number; soldOut: boolean; profit: K | null }
export interface RushResult { player: RushPlayer['tally'] & { closePrice: K; used: Stock; left: Stock;
  gouged: boolean; brokeCartel: boolean }; shops: ShopDayResult[]; customers: number;
  eligible: number; emptyHanded: number; taxFund: K }

export type ChoiceLabel = 'skimp' | 'cartelKept' | 'cartelBroke' | 'shockTopping' | 'blackMarket'
  | 'taxEvaded' | 'inspectPass' | 'inspectFail';
export interface DaySummary {
  day: Day; openPrice: K; closePrice: K; tea: TeaGrade; bought: Stock; used: Stock; wasteValue: K;
  cups: number; wrong: number; walkouts: number;
  revenue: K; cost: K; tax: K; fines: K; profit: K; cash: K; rep: number; score: K;
  upgrade: UpgradeId | null; cards: { id: CardId; choice: Choice }[]; labels: ChoiceLabel[]; lost: boolean;
}
export type RepReason = 'tea' | 'wrong' | 'walkout' | 'gouge' | 'clean' | 'banner' | 'delayed' | CardId;
export interface RepItem { reason: RepReason; delta: number; count?: number; when: 'morning' | 'evening' }
export interface DayReport { summary: DaySummary; repItems: RepItem[]; repBefore: number;
  street: ShopDayResult[]; emptyHanded: number; eligible: number; taxFund: K;
  lesson: { id: string; data: Record<string, number> } }

export interface PendingEffect { day: Day; source: CardId | 'cartelBreak'; rep?: number; cash?: K;
  tempStaff?: true; adCustomers?: number }
export interface AiShopState { id: AiShopId; status: 'notYet' | 'active' | 'closed'; closedOn: Day | null;
  todayPrice: K | null; resting: boolean; probeDir: -1 | 1;
  history: { day: Day; closePrice: K | null; sold: number; profit: K; rested: boolean }[] }
export interface RunFlags { cartel: 'none' | 'refused' | 'agreed'; cartelBroken: boolean; shockTopping: boolean;
  blackMarket: boolean; taxEvaded: boolean; inspection: 'none' | 'wait' | 'pass' | 'fail'; reporter: Choice | null }
export interface RunState {
  v: 1; seed: number; runId: string; day: Day; phase: Phase;
  cash: K; rep: number; upgrades: UpgradeId[]; skimpDays: number;
  flags: RunFlags; pending: PendingEffect[];
  sideDeck: SideCardId[]; sideDrawn: SideCardId[];
  shops: AiShopState[]; plan: MorningPlan; morningNews: RepItem[];
  today: null | { plan: MorningPlan; spent: K; tempStaff: boolean };
  rushResult: RushResult | null;
  cards: CardId[]; cardIndex: number; choices: { id: CardId; choice: Choice }[]; cardRep: RepItem[];
  reports: DayReport[]; outcome: null | 'finished' | 'lostTrust';
}
```

```ts
// rng.ts
export type Rng = () => number;
export function mulberry32(seed: number): Rng;
export function shuffle<T>(arr: readonly T[], random: Rng): T[];
export function hashSeed(seed: number, key: string): number;
export function stream(seed: number, key: string): Rng;

// customers.ts
export function customerCount(day: Day, cfg?): number;
export function generateCustomers(seed: number, day: Day, cfg?): Customer[];
export function generateAdCustomers(seed: number, day: Day, firstId: number, count: number, cfg?): Customer[];

// choice.ts
export interface ShopOffer { id: ShopId; slot: number; open: boolean; price: K; rep: number; queue: number;
  canServe: boolean; dropPermille: number }
export function score10(c: Customer, o: ShopOffer, queueAhead?: number, cfg?): number;
export function passesSkeptic(c: Customer, dropPermille: number): boolean;
export function evaluate(c: Customer, offers: readonly ShopOffer[], visited: readonly ShopId[], cfg?):
  { chosen: ShopId | null; verdicts: ShopVerdict[] };
export function staysAfterReprice(c: Customer, o: ShopOffer, ahead: number, cfg?): { stay: boolean; cause?: LeaveCause };

// shops.ts
export const STREET: readonly ShopId[];
export function earned(closePrice: K, sold: number, cfg?): K;
export function clampAiPrice(id: AiShopId, price: K, rules: DayRules, cfg?): K;
export function restsToday(id: AiShopId, rules: DayRules, cfg?): boolean;
export function morningPrices(shops: readonly AiShopState[],
  playerHistory: readonly { day: Day; closePrice: K; sold: number }[], rules: DayRules, flags: RunFlags, cfg?): AiShopState[];
export function midRushPrice(shop: RushShop, tick: Tick, rules: DayRules, cfg?): K | null;
export function aiProfit(id: AiShopId, r: ShopDayResult, rules: DayRules, cfg?): K;
export function applyExits(shops: readonly AiShopState[], day: Day): AiShopState[];

// rush.ts
export interface RushInput { seed: number; rules: DayRules; ai: readonly AiShopState[];
  player: { price: K; tea: TeaGrade; stock: Stock; rep: number; machine: boolean; staff: boolean;
            skimpDays: number; selfCertified: boolean }; adCustomers: number }
export interface StepResult { state: RushState; events: SimEvent[] }
export function createRush(input: RushInput, cfg?): StepResult;
export function step(state: RushState, actions: readonly Action[], cfg?): StepResult;   // đúng một nhịp
export function finishRush(state: RushState, cfg?): StepResult;
export function summarizeRush(state: RushState, cfg?): RushResult;
export function orderPrice(price: K, order: Order, cfg?): K;
export function cupPrice(price: K, cup: Cup, cfg?): K;
export function payment(price: K, order: Order, cup: Cup, cfg?): { correct: boolean; paid: K };
export function canServe(stock: Stock, order: Order, cfg?): boolean;
export function checkInput(craft: CraftState, input: CraftInput, stock: Stock | null, cfg?): InputReject | null;
export function canDeliver(craft: CraftState): boolean;
export function counterView(state: RushState, cfg?): { first: { customer: number; order: Order; patienceLeft: Tick }[]; rest: number };

// cards.ts
export interface CardDef { id: CardId; kind: 'story' | 'side'; speaker: string; lines: string[];
  a: { label: string; affects: ('cash' | 'rep' | 'stock' | 'law')[] }; b: CardDef['a'] }
export const CARDS: Record<CardId, CardDef>;
export function shuffleSideDeck(seed: number): SideCardId[];
export function cardsForDay(run: RunState): CardId[];
export function applyChoice(run: RunState, card: CardId, choice: Choice, cfg?): RunState;

// day.ts
export function dayRules(run: RunState, cfg?): DayRules;
export function planCost(run: RunState, plan: MorningPlan, cfg?): { tea: K; toppings: K; upgrade: K; total: K; cashAfter: K };
export function validatePlan(run: RunState, plan: MorningPlan, cfg?): PlanIssue[];
export function quickFill(run: RunState, level: 'low' | 'mid' | 'high', cfg?): Pick<MorningPlan, 'teaMl' | 'toppings'>;
export function capacityEstimate(run: RunState, plan: MorningPlan, cfg?): number;
export function morningBrief(run: RunState, cfg?): MorningBrief;
export function openDay(run: RunState, plan: MorningPlan, cfg?): { run: RunState; rush: RushState; events: SimEvent[] };
export function closeDay(run: RunState, cfg?): RunState;

// run.ts
export function newRun(seed: number, runId: string, cfg?): RunState;
export function endRush(run: RunState, rush: RushState, cfg?): RunState;
export function chooseCard(run: RunState, choice: Choice, cfg?): RunState;
export function nextDay(run: RunState, cfg?): RunState;
export function score(run: RunState, cfg?): { profit: K; brand: K; total: K };
export function ending(run: RunState, cfg?): { outcome: 'finished' | 'lostTrust'; closedShops: AiShopId[];
  repLosses: RepItem[]; labels: ChoiceLabel[]; profitByDay: K[] };

// autoplay.ts
export interface RushPolicy { delayTicks: number; mistakeRate: number; serve: 'urgent' | 'fifo';
  cup: 'asOrdered' | 'plainS'; reprice: null | { atTick: Tick; to: (s: RushState) => K }; closeWhenEmpty: boolean }
export interface Strategy { id: string; plan(run: RunState, brief: MorningBrief, cfg: SimConfig): MorningPlan;
  card(card: CardId, run: RunState): Choice; rush: RushPolicy }
export interface BotState { cooldown: Tick; rng: number }
export function botStep(state: RushState, bot: BotState, policy: RushPolicy, cfg?): { actions: Action[]; bot: BotState };
export function playRush(rush: RushState, policy: RushPolicy, botSeed: number, cfg?, record?: boolean):
  { rush: RushState; frames: { t: Tick; events: SimEvent[] }[] };
export function playRun(seed: number, strategy: Strategy, cfg?): { run: RunState; reports: DayReport[]; total: K };
export const STRATEGIES: Record<string, Strategy>;
export function storyCombos(base: Strategy): Strategy[];
```
