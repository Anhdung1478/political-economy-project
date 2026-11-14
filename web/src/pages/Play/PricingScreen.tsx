import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { GAME, ROUNDS, capacityAfter, ingredientBase, roundCustomers, type RoundRule } from '../../../../shared/config';
import type { PublicPlayer } from '../../../../shared/types';
import { fmtK, fmtProfit } from '../../game/format';
import { api, storage } from '../../net/socket';
import { Button } from '../../ui/Button';
import { Countdown } from '../../ui/Countdown';
import { cx } from '../../ui/cx';
import { Slider } from '../../ui/Slider';

const LAST_PRICE = 'hbt.price';

interface Props { round: RoundRule; index: number; me: PublicPlayer; shops: number; deadline: number | null; serverOffset: number }

export function PricingScreen({ round, index, me, shops, deadline, serverOffset }: Props) {
  const [price, setPrice] = useState(() => {
    const last = Number(storage.get(LAST_PRICE)) || GAME.defaultPrice;
    return Math.min(round.maxPrice, Math.max(GAME.priceMin, last));
  });
  const base = ingredientBase(round);
  const [ingredient, setIngredient] = useState(base);
  const [sent, setSent] = useState<{ price: number; ingredient: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = ingredient + round.tax;
  const margin = price - cost;
  const locked = sent !== null && sent.price === price && sent.ingredient === ingredient;
  const loyal = me.loyalMaxPrice !== null && price <= me.loyalMaxPrice;
  const lastRound = index === ROUNDS.length - 1;

  const submit = async () => {
    setBusy(true);
    const r = await api.price(price, ingredient);
    setBusy(false);
    if (r.ok) {
      setSent({ price, ingredient }); setError(null);
      // A price forced down by a ceiling should not become next round's default.
      if (round.maxPrice === GAME.priceMax) storage.set(LAST_PRICE, String(price));
    }
    else setError(r.error);
  };

  return (
    <div className="pricing">
      <div className="pricing__head">
        <div>
          <span className="chip">Vòng {index + 1} · {round.emoji} {round.title}</span>
          <h1>Chọn giá bán</h1>
        </div>
        <Countdown deadline={deadline} serverOffset={serverOffset} total={GAME.pricingSeconds} size={78} />
      </div>

      {(me.capacity < GAME.capacity || me.loyalMaxPrice !== null) && (
        <div className="pricing__status">
          {me.capacity < GAME.capacity && <p className="is-bad">😬 Mất uy tín vì ăn bớt nguyên liệu: vòng này bán tối đa <b>{me.capacity} ly</b>.</p>}
          {me.loyalMaxPrice !== null && (
            <p className={loyal ? 'is-good' : undefined}>💛 Vòng trước bán lỗ nên có {GAME.loyalBuyers} khách quen: chắc chắn mua nếu giá ≤ <b>{fmtK(me.loyalMaxPrice)}</b>.</p>
          )}
        </div>
      )}

      <div className="card pricing__card">
        <Slider label="Giá bán mỗi ly" min={GAME.priceMin} max={round.maxPrice} value={price}
          onChange={v => { setPrice(v); setError(null); }} format={fmtK} />
        {round.fixedCost ? (
          <p className="pricing__tip">🔒 Vòng này nguyên liệu cố định {fmtK(base)}/ly, không ăn bớt được.</p>
        ) : (
          <>
            <Slider label="Chi phí nguyên liệu mỗi ly" min={GAME.costMin} max={base} value={ingredient}
              onChange={v => { setIngredient(v); setError(null); }} format={fmtK} />
            <p className={cx('pricing__tip', ingredient < base && 'is-warn')}>
              {ingredient < base
                ? `🥄 Ăn bớt ${base - ingredient}k: khách vẫn mua bình thường, nhưng vòng sau mất uy tín, chỉ bán tối đa ${capacityAfter(ingredient)} ly.`
                : `Nguyên liệu chuẩn ${base}k. Kéo xuống để ăn bớt (tối thiểu ${GAME.costMin}k).`}
            </p>
          </>
        )}
        <div className="pricing__facts">
          <div><small>Vốn mỗi ly{round.tax > 0 ? ` (gồm thuế ${round.tax}k)` : ''}</small><b>{fmtK(cost)}</b></div>
          <div className={cx('pricing__margin', margin < 0 && 'is-loss', margin === 0 && 'is-zero')}>
            <small>Lãi mỗi ly</small>
            <motion.b key={margin} initial={{ y: -6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }}>{fmtProfit(margin)}</motion.b>
          </div>
        </div>
        <p className="pricing__tip">
          {margin < 0 ? (lastRound ? 'Bán dưới vốn = lỗ mỗi ly. Vòng cuối rồi, không có khách quen bù lại đâu 😇' : `Bán dưới vốn = lỗ mỗi ly. Bù lại vòng sau có ${GAME.loyalBuyers} khách quen nếu không tăng giá quá 20% 😇`)
            : price >= 40 ? 'Giá chát quá, khách sẽ đi quán khác trước 🦈'
              : price <= 18 ? 'Rẻ thế này khách xếp hàng, nhưng lãi mỏng lắm'
                : 'Khách mua quán rẻ nhất trước — cân nhắc nhé'}
          {' '}· 👥 {roundCustomers(round, shops)} khách vòng này
        </p>
      </div>

      {error && <p className="field__error" role="alert">{error}</p>}
      <Button size="xl" block variant={locked ? 'secondary' : 'primary'} disabled={busy || locked} onClick={submit}
        icon={locked ? '✅' : '🥤'}>
        {locked ? `Đã chốt ${fmtK(price)}` : sent !== null ? `Đổi sang ${fmtK(price)}` : `Chốt giá ${fmtK(price)}`}
      </Button>
      <AnimatePresence>
        {(locked || (me.submitted && sent === null)) && (
          <motion.p className="play__sub pricing__wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Ngồi chờ đối thủ… vẫn đổi giá được tới khi hết giờ.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
