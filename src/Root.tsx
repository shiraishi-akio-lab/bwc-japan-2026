import { useEffect, useState } from "react";
import { App } from "./App";
import { Manager } from "./Manager";
import { MeContext, SESSION_EXPIRED, type Me } from "./me";
import { Button, ErrorNotice, Logo } from "./ui";
import { W } from "./words";

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
    <main className="login">
      <div className="login-card card">
        <h1><Logo className="login-logo" /></h1>
        <p className="login-note">{W.login.lead}（{W.app.fictional}）</p>
        <ErrorNotice message={error} />
        <form onSubmit={submit} className="stack">
          <label className="field">
            {W.login.email}
            <input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            {W.login.password}
            <input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <Button type="submit" disabled={busy}>{W.login.submit}</Button>
        </form>
      </div>
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
      {me.role === "manager" ? <Manager onLogout={logout} /> : <App onLogout={logout} />}
    </MeContext.Provider>
  );
}
