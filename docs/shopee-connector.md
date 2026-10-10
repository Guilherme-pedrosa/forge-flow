# Conector de pedidos Shopee

O código consulta a API oficial Shopee Brasil e registra pedidos na caixa comum dos canais. A conta só recebe o estado de autorização registrada depois de trocar o código e consultar a loja autorizada. Esta entrega não executou autorização real, não cadastrou segredos e não ativou consulta contínua em segundo plano.

## Ativação

1. Tenha um aplicativo de produção aprovado no Shopee Open Platform, com acesso às APIs de loja e pedidos. Confirme as permissões e autorize uma loja brasileira; autorização por conta principal com várias lojas não está implementada.
2. No Console Shopee, configure o retorno para a URL HTTPS da página `/integracoes/marketplaces` do seu ERP. O domínio/endereço precisa atender à validação do aplicativo.
3. No ambiente servidor das Edge Functions, configure `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` e `SHOPEE_REDIRECT_URI`. `SHOPEE_PARTNER_ID` é o identificador numérico exato do aplicativo; `SHOPEE_PARTNER_KEY` é sua chave secreta; `SHOPEE_REDIRECT_URI` é o retorno HTTPS configurado, sem query ou fragmento. Não crie variáveis `VITE_` para esses valores e não os coloque em arquivos enviados ao navegador.
4. A variável servidor opcional `SHOPEE_API_REGION` aceita somente `BR` ou `GLOBAL`; o padrão é `BR`. Os hosts são fixos: `https://openplatform.shopee.com.br` e `https://partner.shopeemobile.com`. Mesmo com host global, esta entrega aceita apenas loja `BR` e pedidos em `BRL`.
5. Aplique as migrations de inbox, credenciais Shopee e, se utilizada, política operacional. Publique `shopee-sync` com `verify_jwt=true`, preservando a validação adicional da sessão, papel e empresa dentro da função. As variáveis padrão Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) continuam exclusivas ao servidor quando forem secretas.
6. Cadastre ou selecione uma conta Shopee em Marketplaces e clique **Autorizar Shopee**. Autorize por uma conta de loja e conclua o retorno na mesma sessão ERP. A troca exige o `state` de uso único vinculado ao usuário e o `shop_id`; callback sem estado ou de outra loja não conecta a conta. Somente responsáveis financeiros pela empresa podem autorizar.

Tokens são guardados na tabela de credenciais sem leitura para clientes autenticados/visitantes. A renovação serializa por conta, persiste o par rotativo e valida identidade e lease. Solicitações antigas não podem substituir tokens recentes nem invalidar uma autorização mais nova. O navegador recebe apenas resultado e identificação da conta.

## Consulta e conferência

**Buscar pedidos recentes** consulta `update_time`, incluindo mudanças de pagamento, cancelamento e pendências, em páginas de 20 e intervalos de até 15 dias. **Buscar próxima página** mantém a mesma janela efetiva e usa o cursor oficial. Também é possível consultar até 50 números de pedido específicos. Não há agendamento, webhook público, comando de impressora, compra, conciliação automática ou emissão de etiqueta implementados pelo conector.

O prazo vem exclusivamente de `ship_by_date`, timestamp Unix que a Shopee define como limite para despacho. O ERP converte o instante para ISO/UTC e o mostra no fuso do usuário. `days_to_ship`, estimativas de entrega e horários locais presumidos não geram prazo. Se o canal omitir o instante, o pedido permanece para conferência; use a importação com o prazo real obtido no canal antes de organizar a venda.

O vínculo identifica anúncio e modelo (`item_id` + `model_id`), preservando inclusive modelo `0`. SKU de modelo é preferido; o SKU pai permanece como auxílio quando não existir SKU de modelo. O preço descontado zero de bundles é preservado. Listas de itens são ordenadas de forma determinística para que uma simples reordenação da resposta não gere alteração comercial.

Pedidos não pagos, pagamento/valor/COD não comprovados, pendências sistêmicas, cancelamento solicitado e estados desconhecidos não liberam produção. `IN_CANCEL` representa análise do pedido de cancelamento; somente `CANCELLED` é normalizado como cancelado. Situações de envio/entrega no canal não comprovam etapas internas da fábrica ou recebimento do repasse.

O total pago pelo comprador é preservado separadamente. Frete estimado e custo logístico real não são classificados como frete do comprador ou taxas liquidadas. Nesta etapa, a decomposição não obtida usa zero no frete/desconto canônico e taxas desconhecidas; qualquer divergência com os itens bloqueia a confirmação e pede conferência. O total pode faltar antes do pagamento, sem impedir a importação dos demais pedidos da página. Dados inválidos ou uma resposta incompleta falham sem importar parcialmente a página.

A política por conta fica desativada por padrão. Quando um responsável a habilita, a mesma importação pode organizar vendas elegíveis usando cliente, previsão de repasse e folga configurados. A resposta/toast informa quantos pedidos foram organizados e quantos precisam de revisão. A consulta Shopee não liquida títulos; previsão de repasse continua diferente de pagamento do comprador.

## Fontes e validação

Contratos consultados em 10/10/2026. Os portais oficiais bloquearam o acesso direto, mas seu conteúdo público foi obtido por um leitor público e corroborado com dois SDKs independentes. As fontes oficiais são:

- [Developer Guide: autorização atual com state, assinatura e hosts](https://open.shopee.com/documents?module=87&type=2&id=58&version=2).
- [Listagem de pedidos](https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1) e [detalhe, prazo, modelos e pagamento](https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1).
- [Troca de código](https://open.shopee.com/documents/v2/v2.public.get_access_token?module=104&type=1), [renovação](https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=104&type=1) e [validação da loja](https://open.shopee.com/documents/v2/v2.shop.get_shop_info?module=92&type=1).
- [Escrow financeiro: valor esperado ainda pode mudar](https://open.shopee.com/documents/v2/v2.payment.get_escrow_detail?module=97&type=1).

`node scripts/test-shopee-edge.mjs` testa o handler real com sessões/API/banco isolados e vetores HMAC independentes. `node scripts/test-shopee-credentials.mjs` aplica todas as migrations em PostgreSQL isolado e verifica segredo, identidade, rotação e leases. Esses testes não comprovam credenciais disponíveis, permissões aprovadas, OAuth real nem funcionamento da API autenticada; a homologação deve conferir uma loja real e seus prazos/valores antes de habilitar organização automática.
