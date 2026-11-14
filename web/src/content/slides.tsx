import type { CSSProperties, ReactNode } from 'react';
import { PlayerCount, PollBars } from '../pages/Presentation/PollBars';
import { SupplyDemandChart } from '../pages/Presentation/SupplyDemandChart';
import { InvisibleHand, VisibleHand } from '../ui/Hands';
import { JoinQR } from '../ui/JoinQR';

export interface Slide {
  id: string;
  speaker: 0 | 1 | 2;
  kicker: string;
  title: ReactNode;
  /** Plain-text title for the jump menu. */
  label: string;
  body: () => ReactNode;
  /** What to say — shown with the N key. */
  notes: string;
}

/* ---------- small building blocks ---------- */

const In = ({ i, children, className, style }: { i: number; children: ReactNode; className?: string; style?: CSSProperties }) => (
  <div className={className ? `in ${className}` : 'in'} style={{ ...style, '--i': i } as CSSProperties}>{children}</div>
);

const Tile = ({ i, icon, title, children, tone }: { i: number; icon: string; title: string; children: ReactNode; tone?: 'matcha' | 'caramel' | 'strawberry' }) => (
  <In i={i} className={`tile${tone ? ` tile--${tone}` : ''}`}>
    <span className="tile__icon" aria-hidden="true">{icon}</span>
    <h3>{title}</h3>
    <p>{children}</p>
  </In>
);

const Photo = ({ src, alt, pos, className }: { src: string; alt: string; pos?: string; className?: string }) => (
  <figure className={className ? `photo ${className}` : 'photo'}>
    <img src={src} alt={alt} style={{ objectPosition: pos }} loading="eager" decoding="async" />
  </figure>
);

/* ---------- the deck ---------- */

export const SLIDES: Slide[] = [
  {
    id: 'cover', speaker: 0, kicker: 'Kinh tế chính trị Mác – Lênin',
    label: 'Bàn tay vô hình hay hữu hình?',
    title: <>Bàn tay <em className="hl hl--matcha">vô hình</em> hay bàn tay <em className="hl hl--caramel">hữu hình</em>?</>,
    body: () => (
      <div className="cover">
        <In i={1} className="cover__q">
          <p className="lead">Một nền kinh tế thị trường <strong>hoàn hảo</strong> nên được vận hành bởi bàn tay nào?</p>
          <div className="cover__hands">
            <InvisibleHand size={150} float />
            <span className="cover__vs">VS</span>
            <VisibleHand size={150} float />
          </div>
        </In>
        <In i={2} className="cover__poll card">
          <h3>Bạn nghĩ sao? Bình chọn trước khi nghe</h3>
          <div className="cover__poll-row">
            <JoinQR size={170} />
            <PollBars compact />
          </div>
        </In>
      </div>
    ),
    notes: 'Chào cô và các bạn. Nhóm mình sẽ trả lời một câu hỏi tưởng đơn giản: thị trường nên để "tự chạy" hay cần nhà nước "cầm lái"? Trước khi nghe, mời cả lớp quét QR và bình chọn — cuối buổi mình sẽ xem ý kiến có đổi không. Giữ luôn điện thoại, lát nữa có game.',
  },
  {
    id: 'perfect', speaker: 0, kicker: 'Khái niệm',
    label: 'Thị trường hoàn hảo là gì?',
    title: <>Thị trường “hoàn hảo” trông như thế nào?</>,
    body: () => (
      <div className="stack">
        <div className="grid grid--4">
          <Tile i={1} icon="👥" title="Rất đông người mua, người bán">Không ai đủ lớn để một mình quyết định giá.</Tile>
          <Tile i={2} icon="🧋" title="Hàng hoá đồng nhất">Ly trà sữa quán nào cũng như quán nào.</Tile>
          <Tile i={3} icon="🔎" title="Thông tin đầy đủ">Ai cũng biết giá, biết chất lượng, không ai bị lừa.</Tile>
          <Tile i={4} icon="🚪" title="Tự do ra – vào thị trường">Muốn mở quán thì mở, lỗ thì đóng cửa.</Tile>
        </div>
        <In i={5} className="callout">
          <span aria-hidden="true">⚠️</span>
          <p>Đây là <strong>mô hình lý tưởng</strong> để phân tích — ngoài đời gần như không có thị trường nào đủ cả bốn điều kiện.</p>
        </In>
      </div>
    ),
    notes: 'Thị trường cạnh tranh hoàn hảo cần 4 điều kiện: rất nhiều người mua bán, hàng hoá đồng nhất, thông tin đầy đủ, tự do gia nhập và rút lui. Nhấn mạnh: đây là mô hình lý tưởng — chữ "hoàn hảo" trong câu hỏi là một giả định, và phần sau nhóm sẽ quay lại điểm này.',
  },
  {
    id: 'smith', speaker: 0, kicker: 'Adam Smith · 1776',
    label: 'Adam Smith và bàn tay vô hình',
    title: <>Adam Smith và “bàn tay vô hình”</>,
    body: () => (
      <div className="split split--photo">
        <In i={1}><Photo src="/img/photo-f171493148-500.jpg" alt="Chân dung Adam Smith" className="photo--portrait" /></In>
        <div className="stack">
          <In i={2} className="quote">
            <p>“Chúng ta có bữa tối không phải nhờ lòng tốt của người bán thịt, người nấu bia hay người làm bánh, mà nhờ họ quan tâm tới lợi ích của chính họ.”</p>
            <span>— <em>Của cải của các dân tộc</em>, 1776</span>
          </In>
          <In i={3} className="flow">
            <span className="flow__step">Mỗi người theo đuổi <strong>lợi ích riêng</strong></span>
            <span className="flow__arrow" aria-hidden="true">→</span>
            <span className="flow__step">Cạnh tranh & giá cả <strong>dẫn dắt</strong></span>
            <span className="flow__arrow" aria-hidden="true">→</span>
            <span className="flow__step flow__step--win"><strong>Lợi ích chung</strong> của xã hội</span>
          </In>
          <In i={4}><p className="muted">Nhà nước chỉ nên làm “người gác đêm”: quốc phòng, tư pháp, công trình công cộng.</p></In>
        </div>
      </div>
    ),
    notes: 'Adam Smith — cha đẻ kinh tế học cổ điển. Ý chính: không cần ai ra lệnh, mỗi người lo cho lợi ích của mình, nhưng qua cạnh tranh và giá cả, kết quả lại có lợi cho cả xã hội — như có một bàn tay vô hình dẫn dắt. Vai trò nhà nước theo ông nên tối thiểu.',
  },
  {
    id: 'mechanism', speaker: 0, kicker: 'Cơ chế vận hành',
    label: 'Ba quy luật của thị trường',
    title: <>Giá cả là tín hiệu, cạnh tranh là động cơ</>,
    body: () => (
      <div className="split">
        <div className="stack">
          <Tile i={1} icon="⚖️" title="Quy luật giá trị" tone="matcha">Sản xuất và trao đổi dựa trên hao phí lao động xã hội cần thiết; giá cả xoay quanh giá trị.</Tile>
          <Tile i={2} icon="📈" title="Quy luật cung – cầu" tone="matcha">Cầu vượt cung → giá tăng → người bán sản xuất thêm. Cung vượt cầu → giá giảm.</Tile>
          <Tile i={3} icon="🏁" title="Quy luật cạnh tranh" tone="matcha">Buộc người sản xuất cải tiến kỹ thuật, hạ chi phí để không bị loại.</Tile>
        </div>
        <In i={2} className="card chart-card"><SupplyDemandChart mode="free" /></In>
      </div>
    ),
    notes: 'Ba quy luật kinh tế chủ yếu của thị trường theo giáo trình. Bấm "Cầu tăng" trên biểu đồ: đường cầu dịch phải, điểm cân bằng mới có giá cao hơn và sản lượng lớn hơn — không ai ra lệnh, giá tự điều chỉnh.',
  },
  {
    id: 'strengths', speaker: 0, kicker: 'Ưu thế',
    label: 'Ưu thế của kinh tế thị trường',
    title: <>Khi bàn tay vô hình làm tốt việc của nó</>,
    body: () => (
      <div className="stack">
        <div className="grid grid--3">
          <Tile i={1} icon="⚡" title="Động lực sáng tạo" tone="matcha">Cạnh tranh buộc doanh nghiệp đổi mới, tăng năng suất.</Tile>
          <Tile i={2} icon="🎯" title="Phân bổ nguồn lực hiệu quả" tone="matcha">Vốn và lao động chảy về nơi cần nhất nhờ tín hiệu giá.</Tile>
          <Tile i={3} icon="🛒" title="Thoả mãn nhu cầu" tone="matcha">Hàng hoá đa dạng, người tiêu dùng được quyền chọn.</Tile>
        </div>
        <In i={4} className="callout callout--matcha">
          <span aria-hidden="true">💡</span>
          <p>Trong thị trường <strong>hoàn hảo</strong>, điểm cân bằng là <strong>hiệu quả</strong>: không thể làm ai lợi hơn mà không làm người khác thiệt đi.</p>
        </In>
      </div>
    ),
    notes: 'Ưu thế của kinh tế thị trường. Ý quan trọng ở dòng cuối: về lý thuyết, nếu thị trường thật sự hoàn hảo thì kết quả là hiệu quả (hiệu quả Pareto). Đây là lý lẽ mạnh nhất của phe "bàn tay vô hình". Chuyển lời cho bạn thứ hai: nhưng ngoài đời thì sao?',
  },
  {
    id: 'failures', speaker: 1, kicker: 'Thực tế',
    label: 'Khuyết tật của thị trường',
    title: <>Ngoài đời, thị trường có “khuyết tật”</>,
    body: () => (
      <div className="grid grid--3">
        <Tile i={1} icon="📉" title="Khủng hoảng" tone="caramel">Kinh tế lên xuống theo chu kỳ, có lúc sụp đổ: 1929, 2008.</Tile>
        <Tile i={2} icon="🏭" title="Ngoại ứng" tone="caramel">Ô nhiễm, cạn kiệt tài nguyên — người gây ra không phải trả giá.</Tile>
        <Tile i={3} icon="👑" title="Độc quyền" tone="caramel">Vài “ông lớn” đủ sức tự đặt giá, bóp chết đối thủ.</Tile>
        <Tile i={4} icon="🌉" title="Hàng hoá công cộng" tone="caramel">Đèn đường, đê điều, quốc phòng: ai cũng dùng, không ai muốn tự trả.</Tile>
        <Tile i={5} icon="🕳️" title="Thông tin bất cân xứng" tone="caramel">Người bán biết rõ hơn người mua — hàng giả, hàng kém chất lượng.</Tile>
        <Tile i={6} icon="⚖️" title="Phân hoá giàu nghèo" tone="caramel">Thị trường thưởng cho hiệu quả, không tự lo công bằng.</Tile>
      </div>
    ),
    notes: 'Giáo trình gọi đây là các khuyết tật của nền kinh tế thị trường. Mỗi khuyết tật là một chỗ mà một trong 4 điều kiện "hoàn hảo" bị vi phạm — ví dụ độc quyền vi phạm điều kiện "rất nhiều người bán", thông tin bất cân xứng vi phạm "thông tin đầy đủ".',
  },
  {
    id: 'keynes', speaker: 1, kicker: '1929 – 1933',
    label: 'Đại suy thoái và Keynes',
    title: <>Đại suy thoái — và lời giải của Keynes</>,
    body: () => (
      <div className="split split--wide-left">
        <div className="collage">
          <In i={1}><Photo src="/img/photo-f17057587-960.jpg" alt="Người thất nghiệp xếp hàng nhận súp miễn phí ở Chicago, 1931" className="photo--wide" /></In>
          <In i={2}><Photo src="/img/photo-f107020992-960.jpg" alt="Đám đông trước Sở Giao dịch Chứng khoán New York, 1929" className="photo--wide" /></In>
        </div>
        <div className="stack">
          <In i={3} className="stat-row">
            <div className="stat"><b>~25%</b><span>người lao động Mỹ thất nghiệp (1933)</span></div>
            <div className="stat"><b>~½</b><span>sản lượng công nghiệp Mỹ biến mất</span></div>
          </In>
          <In i={4} className="keynes">
            <Photo src="/img/photo-f36752324-500.jpg" alt="John Maynard Keynes" pos="50% 30%" className="photo--avatar" />
            <p><strong>J. M. Keynes (1936):</strong> thị trường không tự hồi phục đủ nhanh. Nhà nước phải <strong>kích cầu</strong> — chi tiêu công, giảm thuế, hạ lãi suất.</p>
          </In>
          <In i={5}><p className="muted">2008: các nước lại tung gói cứu trợ khổng lồ để chặn khủng hoảng tài chính.</p></In>
        </div>
      </div>
    ),
    notes: 'Năm 1929 thị trường chứng khoán Mỹ sụp đổ, thất nghiệp lên gần 25%. "Bàn tay vô hình" không tự kéo nền kinh tế dậy. Keynes đưa ra lý thuyết: khi tổng cầu sụp, nhà nước phải chủ động chi tiêu để kích cầu. Từ đây "bàn tay hữu hình" trở thành chính thống ở phương Tây. Năm 2008 cũng vậy.',
  },
  {
    id: 'tools', speaker: 1, kicker: 'Bàn tay hữu hình cầm gì?',
    label: 'Công cụ của nhà nước',
    title: <>Công cụ điều tiết của nhà nước</>,
    body: () => (
      <div className="split split--hand">
        <In i={1} className="hand-stage"><VisibleHand size={230} float /></In>
        <div className="grid grid--2">
          <Tile i={2} icon="📜" title="Pháp luật" tone="caramel">Luật cạnh tranh, bảo vệ người tiêu dùng, bảo vệ môi trường.</Tile>
          <Tile i={3} icon="💰" title="Chính sách tài khoá" tone="caramel">Thuế và chi tiêu công: thu của ai, chi vào đâu.</Tile>
          <Tile i={4} icon="🏦" title="Chính sách tiền tệ" tone="caramel">Lãi suất, cung tiền — do ngân hàng trung ương điều hành.</Tile>
          <Tile i={5} icon="🗺️" title="Quy hoạch & kế hoạch" tone="caramel">Định hướng phát triển, đầu tư vào lĩnh vực then chốt.</Tile>
        </div>
      </div>
    ),
    notes: 'Bàn tay hữu hình không phải là "ra lệnh tuỳ ý", mà dùng các công cụ: pháp luật, tài khoá, tiền tệ, quy hoạch. Mỗi công cụ sửa một khuyết tật cụ thể — ví dụ thuế môi trường xử lý ngoại ứng, luật cạnh tranh xử lý độc quyền.',
  },
  {
    id: 'gov-failure', speaker: 1, kicker: 'Nhưng…',
    label: 'Khi nhà nước làm thay thị trường',
    title: <>Bàn tay hữu hình cũng có lúc vụng về</>,
    body: () => (
      <div className="split">
        <div className="stack">
          <In i={1} className="ration">
            <span className="ration__stamp">TEM PHIẾU</span>
            <p>Việt Nam trước 1986: nhà nước định giá, phân phối bằng tem phiếu.</p>
          </In>
          <In i={2}><ul className="points">
            <li>Giá bị ép thấp hơn giá cân bằng → <strong>hàng khan hiếm</strong>, xếp hàng, chợ đen.</li>
            <li>Không có cạnh tranh → không có động lực làm tốt hơn.</li>
            <li>Năm 1986, lạm phát lên tới <strong>774,7%</strong>.</li>
          </ul></In>
        </div>
        <In i={3} className="card chart-card"><SupplyDemandChart mode="ceiling" /></In>
      </div>
    ),
    notes: 'Can thiệp sai cách cũng gây hại: thời bao cấp là bài học của chính Việt Nam. Biểu đồ: giá trần thấp hơn giá cân bằng thì lượng cầu lớn hơn lượng cung — phần tô đỏ là thiếu hụt, chính là hàng người xếp hàng. Kết luận phần này: thị trường có khuyết tật, nhưng nhà nước cũng có thể thất bại.',
  },
  {
    id: 'answer', speaker: 2, kicker: 'Trả lời câu hỏi',
    label: 'Vậy ai cầm lái?',
    title: <>Vậy rốt cuộc, ai cầm lái?</>,
    body: () => (
      <div className="stack">
        <div className="versus">
          <In i={1} className="versus__side versus__side--matcha">
            <InvisibleHand size={92} />
            <div>
              <h3>Nếu thị trường thật sự hoàn hảo…</h3>
              <p>…thì về lý thuyết bàn tay vô hình là đủ để đạt <strong>hiệu quả</strong>.</p>
            </div>
          </In>
          <In i={2} className="versus__side versus__side--caramel">
            <VisibleHand size={92} />
            <div>
              <h3>Nhưng ngoài đời…</h3>
              <ul className="points points--tight">
                <li>“Hoàn hảo” chỉ có trong mô hình.</li>
                <li>Hiệu quả ≠ <strong>công bằng</strong>.</li>
                <li>Chính các điều kiện “hoàn hảo” (luật chơi, thông tin, cạnh tranh) cần nhà nước giữ.</li>
              </ul>
            </div>
          </In>
        </div>
        <In i={3} className="verdict">
          <span>🚗</span>
          <p>Bàn tay vô hình là <strong className="hl hl--matcha">động cơ</strong> — bàn tay hữu hình là <strong className="hl hl--caramel">vô-lăng</strong>.</p>
        </In>
      </div>
    ),
    notes: 'Đây là câu trả lời của nhóm. Nếu thật sự hoàn hảo thì bàn tay vô hình đủ cho hiệu quả — nhưng giả định đó không tồn tại, và hiệu quả không có nghĩa là công bằng. Thậm chí để thị trường tiến gần "hoàn hảo" cũng cần nhà nước: luật cạnh tranh, minh bạch thông tin. Hình ảnh dễ nhớ: thị trường là động cơ, nhà nước là vô-lăng.',
  },
  {
    id: 'vietnam', speaker: 2, kicker: 'Liên hệ Việt Nam',
    label: 'Kinh tế thị trường định hướng XHCN',
    title: <>Kinh tế thị trường định hướng xã hội chủ nghĩa</>,
    body: () => (
      <div className="stack">
        <In i={1} className="timeline">
          <div className="timeline__item"><b>Trước 1986</b><span>Kế hoạch hoá tập trung, bao cấp</span></div>
          <div className="timeline__item timeline__item--key"><b>1986 · Đại hội VI</b><span>Đổi mới, chuyển sang kinh tế nhiều thành phần</span></div>
          <div className="timeline__item"><b>2001 · Đại hội IX</b><span>Xác định mô hình KTTT định hướng XHCN</span></div>
        </In>
        <div className="grid grid--3">
          <Tile i={2} icon="⛽" title="Quỹ bình ổn giá xăng dầu" tone="strawberry">Giá xăng theo thị trường, nhưng có quỹ đệm để giảm cú sốc.</Tile>
          <Tile i={3} icon="🧾" title="Giảm thuế VAT 10% → 8%" tone="strawberry">Kích cầu tiêu dùng sau dịch, áp dụng từ năm 2022.</Tile>
          <Tile i={4} icon="🤝" title="Gói hỗ trợ COVID-19" tone="strawberry">Nghị quyết 68/NQ-CP (2021): khoảng 26.000 tỷ đồng cho người lao động.</Tile>
        </div>
      </div>
    ),
    notes: 'Việt Nam chọn đúng con đường kết hợp: thị trường quyết định giá cả và phân bổ nguồn lực, nhà nước định hướng và điều tiết, bảo đảm tiến bộ và công bằng xã hội. Ba ví dụ gần gũi: quỹ bình ổn xăng dầu, giảm VAT 2%, gói hỗ trợ COVID.',
  },
  {
    id: 'conclusion', speaker: 2, kicker: 'Kết luận',
    label: 'Kết luận',
    title: <>Không phải “hay” — mà là “và”</>,
    body: () => (
      <div className="split">
        <div className="stack">
          <In i={1}><ul className="points points--big">
            <li><strong>Thị trường</strong> phân bổ nguồn lực và tạo động lực.</li>
            <li><strong>Nhà nước</strong> đặt luật chơi, sửa khuyết tật, giữ công bằng.</li>
            <li><strong>Liều lượng</strong> thay đổi theo hoàn cảnh: khủng hoảng cần tay lái chắc hơn.</li>
          </ul></In>
        </div>
        <In i={2} className="card poll-card">
          <h3>Đầu giờ cả lớp đã chọn…</h3>
          <PollBars />
          <p className="poll-card__verdict">Đáp án của nhóm: <strong>cả hai</strong> 🤝</p>
        </In>
      </div>
    ),
    notes: 'Tóm lại ba ý. Nhìn kết quả bình chọn đầu giờ: phe nào đông hơn? Dù chọn bên nào, các bạn đều đúng một nửa. Chuyển sang game: giờ chính các bạn sẽ làm chủ quán trà sữa dưới cả hai bàn tay.',
  },
  {
    id: 'game', speaker: 2, kicker: 'Hết phần nghe — tới phần chơi',
    label: 'Game: Chợ Trà Sữa Hỗn Loạn',
    title: <>Chợ Trà Sữa <em className="hl hl--strawberry">Hỗn Loạn</em> 🧋</>,
    body: () => (
      <div className="split">
        <div className="stack">
          <In i={1}><p className="lead">Mỗi bạn là chủ một quán trà sữa. Mỗi vòng chỉ làm một việc: <strong>chọn giá bán</strong>.</p></In>
          <In i={2}><ul className="points">
            <li>Vốn 15k/ly, mỗi quán pha tối đa 10 ly.</li>
            <li>Khách mua ở quán <strong>rẻ nhất trước</strong>, giá quá túi tiền thì bỏ đi.</li>
            <li>4 vòng, mỗi vòng một “bàn tay” khác nhau xuất hiện.</li>
            <li>Lãi nhiều nhất thì thắng. Ế nhất… cũng có giải.</li>
          </ul></In>
          <In i={3} className="chip chip--matcha game-joined"><PlayerCount /> chủ quán đã vào chợ</In>
        </div>
        <In i={2} className="game-qr">
          <JoinQR size={300} />
          <p className="muted">Đã vào từ đầu giờ thì không cần quét lại.</p>
        </In>
      </div>
    ),
    notes: 'Giới thiệu luật trong 15 giây, rồi mở màn hình host (/host) để bắt đầu game.',
  },
];

export const PHOTO_CREDITS = 'Ảnh tư liệu: Wikimedia Commons, phạm vi công cộng (public domain).';
