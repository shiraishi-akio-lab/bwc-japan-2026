import { createContext, useContext } from "react";

// 画面の出し分けだけに使う。権限の判定はサーバーが行う
export type Me = { displayName: string; email: string; role: "rep" | "manager"; companyName: string };

export const MeContext = createContext<Me | null>(null);

export const useMe = () => {
  const me = useContext(MeContext);
  if (!me) throw new Error("ログインしていません");
  return me;
};

export const SESSION_EXPIRED = "session-expired";
export const noticeExpired = (status: number) => {
  if (status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED));
};
