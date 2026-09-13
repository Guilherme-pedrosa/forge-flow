import { LayoutDashboard, ArrowUpFromLine, ArrowDownToLine, Wallet, PiggyBank, BookOpen, Package, ArrowRightLeft, AlertTriangle, Printer, Hammer, BarChart3, ShoppingCart, FileText, Store, Link2, Building, UserCog, Users, Handshake, CalendarRange } from "lucide-react";

export const navigationGroups = [
  { label: "Operação", items: [
    { title: "Visão geral", icon: LayoutDashboard, href: "/" },
    { title: "Pedidos", icon: FileText, href: "/comercial/pedidos" },
    { title: "Jobs de produção", icon: Hammer, href: "/producao/jobs" },
    { title: "Fila de impressão", icon: CalendarRange, href: "/planejamento/fila" },
    { title: "Impressoras", icon: Printer, href: "/producao/impressoras" },
    { title: "Margens de produção", icon: BarChart3, href: "/producao/margem" },
    { title: "Qualidade e perdas", icon: AlertTriangle, href: "/producao/perdas" },
  ] },
  { label: "Financeiro", items: [
    { title: "Contas a pagar", icon: ArrowUpFromLine, href: "/financeiro/pagar" },
    { title: "Contas a receber", icon: ArrowDownToLine, href: "/financeiro/receber" },
    { title: "Caixa e bancos", icon: Wallet, href: "/financeiro/caixa" },
    { title: "Conciliação", icon: PiggyBank, href: "/financeiro/conciliacao" },
    { title: "Demonstrativo de resultado", icon: BookOpen, href: "/financeiro/dre" },
  ] },
  { label: "Estoque e compras", items: [
    { title: "Materiais e insumos", icon: Package, href: "/estoque/itens" },
    { title: "Movimentações", icon: ArrowRightLeft, href: "/estoque/movimentacoes" },
    { title: "Compras", icon: ShoppingCart, href: "/estoque/compras" },
    { title: "Alertas de estoque", icon: AlertTriangle, href: "/estoque/alertas" },
  ] },
  { label: "Comercial", items: [
    { title: "Clientes", icon: Users, href: "/comercial/clientes" },
    { title: "Catálogo de produtos", icon: Package, href: "/comercial/produtos" },
    { title: "Consignação", icon: Handshake, href: "/comercial/consignado" },
    { title: "Marketplaces", icon: Store, href: "/comercial/marketplaces" },
  ] },
  { label: "Administração", items: [
    { title: "Bambu Lab", icon: Link2, href: "/integracoes/bambu" },
    { title: "Mercado Livre", icon: Store, href: "/integracoes/ml" },
    { title: "Empresa e parâmetros", icon: Building, href: "/configuracoes" },
    { title: "Usuários e acesso", icon: UserCog, href: "/configuracoes/usuarios" },
    { title: "Histórico de atividades", icon: FileText, href: "/configuracoes/logs" },
  ] },
];
