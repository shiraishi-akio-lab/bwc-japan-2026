import { useEffect, useState } from "react";

type Health = { ok: boolean; cases: number; rubricAxes: number };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((h) => setHealth(h))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1>隣席コーチ（仮）</h1>
      <p>ベテランの商談の「なぜ」を残し、若手の理解に合わせて次の一手を隣で練習させる。</p>
      {error && <p role="alert">API に接続できません：{error}</p>}
      {health && (
        <p>
          API 接続 OK／物差しの軸 {health.rubricAxes} 本／ケースカード {health.cases} 件
        </p>
      )}
    </main>
  );
}
