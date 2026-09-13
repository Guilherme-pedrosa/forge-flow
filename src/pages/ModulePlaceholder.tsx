import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Plug } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

const modules: Record<string, { title: string; description: string; alternative: string; href: string }> = {
  "/integracoes/ml": { title: "Mercado Livre", description: "A conexão automática com o Mercado Livre ainda não está disponível nesta versão. Pedidos, taxas e recebimentos precisam ser registrados nos módulos correspondentes.", alternative: "Gerenciar pedidos", href: "/comercial/pedidos" },
  "/comercial/marketplaces": { title: "Marketplaces", description: "A importação automática de vendas de marketplaces ainda não está disponível. Você pode registrar as vendas, os produtos e os recebimentos pela operação comercial.", alternative: "Gerenciar pedidos", href: "/comercial/pedidos" },
  "/producao/perdas": { title: "Qualidade e perdas", description: "Acompanhe os jobs com falha e registre o motivo no módulo de produção. O registro de consumo e perdas de materiais fica nas movimentações de estoque.", alternative: "Abrir produção", href: "/producao/jobs" },
};

export default function ModulePlaceholder() {
  const { pathname } = useLocation();
  const module = modules[pathname] ?? { title: "Módulo indisponível", description: "Esta funcionalidade ainda não está disponível nesta versão.", alternative: "Voltar à visão geral", href: "/" };
  return <div className="page-enter"><PageHeader title={module.title} /><section className="rounded-xl border bg-card p-6 sm:p-10"><div className="flex max-w-2xl flex-col items-start gap-5 sm:flex-row"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted"><Plug className="h-6 w-6 text-muted-foreground" /></span><div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Disponibilidade do módulo</p><h2 className="text-lg">{pathname === "/producao/perdas" ? "Acompanhamento pela produção" : "Integração ainda não disponível"}</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{module.description}</p><Button asChild className="mt-6"><Link to={module.href}>{module.alternative}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div></div></section></div>;
}
