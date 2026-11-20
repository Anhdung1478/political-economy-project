import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { usePlayUrl } from './usePlayUrl';

/** QR code pointing phones at /play, plus the short URL in words. */
export function JoinQR({ size = 220, showUrl = true }: { size?: number; showUrl?: boolean }) {
  const url = usePlayUrl();
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#2a1d15', light: '#0000' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [url]);
  return (
    <div className="qr">
      <div className="qr__code" style={{ width: size + 32, height: size + 32 }} role="img" aria-label={`Mã QR mở ${url}`}
        dangerouslySetInnerHTML={{ __html: svg }} />
      {showUrl && <p className="qr__url">{url.replace(/^https?:\/\//, '')}</p>}
    </div>
  );
}
