// How objects look (UX-04), display only - never dimensions, provenance or what routes see:
// "draft" draws solid illustrative materials; "uncertainty" draws objects whose height is only
// assumed see-through, as before; "see-through" fades equipment and walls so a running shift's
// workers show (they still block every route).
import { createContext } from "react";

export type Appearance = "draft" | "uncertainty" | "see-through";
export const AppearanceContext = createContext<Appearance>("draft");
