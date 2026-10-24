# Loracê ↔ Forge & Flow

## Plano de execução — 24/10/2026

1. Reutilizar o padrão comprovado do Selovac e do integrador ML: identidade estável, catálogo controlado pelo ERP, conferência de valores no servidor e idempotência.
2. Criar um canal Loracê com publicação individual, categoria comercial, preço do ERP (ou específico do canal), fotos e estoque de produtos acabados. Componentes, custos e dados internos permanecem privados.
3. Substituir a leitura anônima da tabela products por uma API limitada ao catálogo publicado. Remover produtos fictícios e descontos sem configuração.
4. Implementar carrinho, Checkout Pro do Mercado Pago e acompanhamento. O usuário escolheu cobrança online pelo Mercado Pago. Usar conta recebedora explicitamente definida, credenciais no servidor e frete configurado pela loja. O redirect do navegador nunca confirma pagamento.
5. Mostrar os pedidos recebidos no Forge, com cliente, itens e origem. Usar o fluxo existente de confirmação, estoque, produção e financeiro.
6. Testar autorização por empresa, preço adulterado, repetição de envio, estoque, produto despublicado e falhas de conexão. Publicar e verificar os dois sistemas.

## Referências consultadas

- Selovac: `gc-sync.server.ts`, `gestaoclick.server.ts` e `order-automation.server.ts`.
- Integrador ML: `gc-catalog.server.ts` e `ml-orders.server.ts`.
- Lorace Builder: leitura direta de `products` bloqueada por RLS, fallback fictício e botão de carrinho sem ação.

Não abrir leitura pública das tabelas internas. Não enviar mensagens ao agente Lovable.

## Mercado Pago

O endpoint `lorace-payments` recebe checkout público, confirmações assinadas e conexão administrativa autenticada. Preferências usam os itens conferidos no banco, referência estável e recuperação após resposta perdida. Pagamentos são consultados novamente na API e validados por recebedor, ambiente, moeda e valor. Reservas temporárias descontam do saldo disponível; pagamentos tardios e estornos exigem revisão. Aprovação no canal não representa crédito em conta bancária.

Referências oficiais: [preferências Checkout Pro](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview) e [notificações de pagamento](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications).

As telas e SQL não implantam Edge Functions automaticamente. Publicar `lorace-payments` separadamente com `supabase functions deploy lorace-payments --project-ref gaomleftwxpzjivrnzjk --no-verify-jwt`, por um operador com acesso de administração a esse projeto. A função valida a assinatura do webhook e o JWT de cada ação administrativa no próprio código.

No Forge, em Loja Loracê, cadastrar Access Token, segredo do webhook, ambiente, frete e estados atendidos. Configurar o evento Pagamentos no Mercado Pago para `https://gaomleftwxpzjivrnzjk.supabase.co/functions/v1/lorace-payments?webhook=1&store=lorace`. A função precisa estar publicada antes de validar a conta. Nunca inserir secrets no frontend, Git ou chat.

## Validação e estado da implantação

- Migrações 20261024090000 e 20261024100000 aplicadas em 24/10/2026. Canal Loracê criado na Elevare3D. Contagens de produtos, clientes, pedidos e recebíveis preservadas.
- API pública de catálogo responde 200; credenciais e pedidos rejeitam leitura anônima. Checkout permanece indisponível enquanto a conta não estiver validada.
- Testes: catálogo e banco de pagamentos; assinatura e handler HTTP isolado; 9 testes da loja; 14 cenários de confirmação de venda, 22 de estoque parcial e 13 de montagem. TypeScript e builds dos dois projetos aprovados.
- A conta recebedora ainda precisa ser definida pelo proprietário e cadastrada no formulário seguro. Não reutilizar credenciais do Selovac sem essa definição.
- Os dois produtos finais existentes ainda estão sem preço de venda e sem saldo. Definir preço, publicação e, se aplicável, encomenda com prazo antes de ofertar. Nenhum preço, frete ou produto de demonstração foi inventado.
- A função de pagamentos retorna 404 no endpoint publicado antes de seu deploy. Publicação da função, conexão da conta, configuração de frete/UFs e teste de checkout com webhook continuam pendentes. Não considerar cobrança operacional antes disso.

## Marca confirmada pelo proprietário

A loja pública se chama **Elevare3D** e usa a logo enviada pelo proprietário. Lorace Builder é a origem do projeto. O identificador interno do canal e da função permanece estável para preservar vínculos; telas, origem dos novos pedidos e identificação do checkout usam Elevare3D. A loja usa o endereço `https://loja-elevare3d.lovable.app` e a gestão no Forge fica em `/integracoes/loja`, preservando o endereço anterior como alias.
