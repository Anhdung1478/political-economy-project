// / and /solo, temporary page (Task 24): Task 22 builds the solo game here. It must never import `net/socket`.
export default function Solo() {
  return (
    <main className="play">
      <header className="play__top">
        <span className="play__brand"><img src="/favicon.svg" alt="" width="28" height="28" /> Phố Trà Sữa</span>
      </header>
      <div className="wait-card"><p><b>Sắp mở cửa</b><br />Chế độ chơi một mình đang được xây.</p></div>
    </main>
  );
}
