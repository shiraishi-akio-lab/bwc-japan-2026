import { useEffect, useState } from "react";
import { App } from "./App";
import { Manager } from "./Manager";
import { MeContext, SESSION_EXPIRED, type Me } from "./me";

const page = { fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "32px auto", padding: "0 16px", lineHeight: 1.6 } as const;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await post<Me>("/api/login", { email, password }));
    } catch (err) {
      setPassword("");
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={page}>
      <h1 style={{ marginBottom: 4 }}>営業GYM</h1>
      <p style={{ marginTop: 0, color: "#555" }}>ログインしてください。（すべて架空のデータです）</p>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      <form onSubmit={submit} style={{ maxWidth: 360 }}>
        <label style={{ display: "block", marginBottom: 8 }}>
          メールアドレス
          <input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          パスワード
          <input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={busy}>ログイン</button>
      </form>
    </main>
  );
}

// 入口：ログインしていなければログイン画面、していれば役割に応じた画面を出す
export function Root() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/me").then(async (r) => setMe(r.ok ? ((await r.json()) as Me) : null)).catch(() => setMe(null));
    const expired = () => {
      window.location.hash = "";
      setMe(null);
    };
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, []);

  const logout = async () => {
    await post("/api/logout").catch(() => undefined);
    window.location.hash = "";
    setMe(null);
  };

  if (me === undefined) return null;
  if (me === null) return <Login onDone={setMe} />;
  return (
    <MeContext.Provider value={me}>
      <div style={{ ...page, margin: "8px auto -24px", fontSize: 14, color: "#555", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>{me.displayName}（{me.role === "manager" ? "上司" : "本人"}）</span>
        <button onClick={logout}>ログアウト</button>
      </div>
      {me.role === "manager" ? <Manager /> : <App />}
    </MeContext.Provider>
  );
}
