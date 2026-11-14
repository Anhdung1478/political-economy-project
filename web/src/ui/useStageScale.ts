import { useLayoutEffect, useState } from 'react';

export const STAGE_W = 1600;
export const STAGE_H = 900;

/** Scale factor that fits a 1600×900 stage inside the window. */
export function useStageScale(): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H));
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return scale;
}
