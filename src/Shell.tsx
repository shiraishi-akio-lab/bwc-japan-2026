import type { ReactNode } from "react";
import { useMe } from "./me";
import { Logo, personName } from "./ui";
import { W } from "./words";

// 全ページ共通の上の段：ロゴ、今の場所、ログイン中の名前とログアウト
export function Shell<K extends string>({ items, current, onGo, onLogout, children }: {
  items: [K, string][]; current: K; onGo: (k: K) => void; onLogout: () => void; children: ReactNode;
}) {
  const me = useMe();
  return (
    <>
      <header className="top">
        <div className="top-in">
          <Logo />
          <nav className="nav">
            {items.map(([k, label]) => (
              <button key={k} type="button" aria-current={k === current ? "page" : undefined} onClick={() => onGo(k)}>{label}</button>
            ))}
          </nav>
          <div className="who">
            <span>{personName(me.displayName)}</span>
            <button type="button" onClick={onLogout}>{W.nav.logout}</button>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
