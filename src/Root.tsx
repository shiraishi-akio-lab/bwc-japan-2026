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
  const [entry, setEntry] = useState(false); // 入口の2つのボタンを出すか。決めるのはサーバー
  const [needPass, setNeedPass] = useState(false);
  const [pass, setPass] = useState("");

  useEffect(() => {
    fetch("/api/demo-entry").then((r) => r.json() as Promise<{ on?: boolean; pass?: boolean }>).then((d) => { setEntry(!!d.on); setNeedPass(!!d.pass); }).catch(() => setEntry(false));
  }, []);

  const enter = async (role: "rep" | "manager") => {
    setBusy(true);
    setError(null);
    try {
      onDone(await post<Me>("/api/demo-entry", { role, pass }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  const form = (
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
  );

  return (
    <main className="login">
      <div className="login-card card">
        <h1><Logo className="login-logo" /></h1>
        <p className="login-note">{entry ? W.login.entryLead : `${W.login.lead}（${W.app.fictional}）`}</p>
        <ErrorNotice message={error} />
        {entry ? (
          <>
            {needPass && (
              <label className="field">
                {W.login.pass}
                <input type="password" name="pass" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
              </label>
            )}
            <div className="stack">
              <button type="button" className="pick" disabled={busy} onClick={() => enter("rep")}>
                <span className="pick-name">{W.login.rep}</span>
                <span className="muted">{W.login.repSub}</span>
              </button>
              <button type="button" className="pick" disabled={busy} onClick={() => enter("manager")}>
                <span className="pick-name">{W.login.manager}</span>
                <span className="muted">{W.login.managerSub}</span>
              </button>
            </div>
            <p className="small login-note">{W.login.entryNote}</p>
            {!needPass && (
              <details>
                <summary className="small">{W.login.byPassword}</summary>
                <div style={{ marginTop: 12 }}>{form}</div>
              </details>
            )}
          </>
        ) : form}
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
