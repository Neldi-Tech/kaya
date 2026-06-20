"use client";
import { createContext, useContext } from "react";
import type { View } from "./Screens";

export interface Nav {
  go: (v: View) => void;
  goWith: (v: View, param: string) => void;
  back: () => void;
  canBack: boolean;
  param: string;
}

export const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error("useNav must be used within NavCtx");
  return n;
}
