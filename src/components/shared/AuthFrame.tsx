import type { ReactNode } from "react";
import { Box, ArrowRight, Layers3 } from "lucide-react";

export function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh bg-background lg:grid-cols-[1fr_1fr]">
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex xl:p-16">
      <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20"><Box className="h-6 w-6" /></span><span className="text-xl font-semibold tracking-tight">Forge <span className="text-white/40">&</span> Flow</span></div>
      <div className="relative z-10 max-w-lg py-16"><span className="text-xs font-medium uppercase tracking-[0.2em] text-teal-300/80">Gestão de impressão 3D</span><h1 className="mt-6 text-4xl font-medium leading-tight text-white xl:text-5xl">Da matéria-prima<br />ao resultado.</h1><p className="mt-6 max-w-sm text-base leading-7 text-white/55">Pedidos, produção, materiais e financeiro no mesmo ambiente de trabalho.</p><div className="mt-10 flex items-center gap-4 text-xs text-white/65"><span className="rounded-full border border-white/15 px-4 py-2">Planejar</span><ArrowRight className="h-4 w-4" /><span className="rounded-full border border-white/15 px-4 py-2">Produzir</span><ArrowRight className="h-4 w-4" /><span className="rounded-full border border-white/15 px-4 py-2">Gerir</span></div></div>
      <div className="flex items-center gap-2 text-xs text-white/40"><Layers3 className="h-4 w-4" />ERP para manufatura aditiva</div>
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-36 h-[500px] w-[500px] rotate-12 rounded-[100px] border border-white/5"><div className="absolute inset-12 rounded-[75px] border border-white/5" /><div className="absolute inset-24 rounded-[50px] border border-white/5" /></div>
    </aside>
    <main className="flex min-w-0 flex-col items-center justify-center px-5 py-10 sm:px-10"><div className="mb-8 flex items-center gap-2.5 text-lg font-semibold lg:hidden"><Box className="h-6 w-6 text-primary" />Forge & Flow</div>{children}<p className="mt-8 text-center text-xs text-muted-foreground">Forge & Flow · Gestão de impressão 3D</p></main>
  </div>;
}
