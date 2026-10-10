# Shopee Open Platform: contrato para integração de pedidos

Consulta em 10/10/2026. Pesquisa somente leitura, sem credenciais, chamadas de negócio, banco operacional ou Lovable. O acesso direto a `open.shopee.com` retornou bloqueio do proxy. As páginas públicas oficiais abaixo foram lidas pelo serviço público `r.jina.ai`; ele informa a URL de origem e, quando disponível, data de publicação. Os arquivos temporários com a resposta do leitor estão em `/tmp/forge-flow-shopee-research/`. Isso comprova o contrato publicado, mas não substitui homologação com uma aplicação Shopee autorizada.

## 1. Autorização: usar o fluxo atual com state nativo

Fonte oficial: [Developer Guide — Authorization and Authentication](https://open.shopee.com/documents?module=87&type=2&id=58&version=2). Leitura: [versão pelo leitor público](https://r.jina.ai/https://open.shopee.com/documents?module=87%26type=2%26id=58%26version=2). O leitor indica publicação em 23/07/2026.

O guia apresenta um método novo de geração do link:

| Ambiente | URL de autorização |
| --- | --- |
| Produção Brasil | `https://open.shopee.com.br/auth` |
| Produção Global, exceto Brasil e China continental | `https://open.shopee.com/auth` |

Parâmetros: `partner_id`, `auth_type=seller`, `redirect_uri`, `response_type=code`; `state` é opcional para a plataforma e deve ser obrigatório no integrador.

Trecho exato sobre `state`:

> “A random, unguessable string used to prevent CSRF attacks. It will be returned as-is to the redirect_uri after authorization is completed.”

O domínio de `redirect_uri` deve corresponder ao Live Redirect URL Domain configurado no Console quando esse domínio estiver declarado. O guia também menciona links legados com parâmetro `redirect`. Exemplos antigos de `/api/v2/shop/auth_partner` com `timestamp/sign/redirect` continuam no mesmo documento. **Não misturar esses dois contratos.** Não foi encontrada evidência específica de preservação de parâmetros arbitrários dentro do `redirect` legado. Usar o `state` nativo do novo `/auth` elimina essa dependência. O novo conjunto de parâmetros publicado não inclui assinatura HMAC no link de autorização.

Após autorização por uma conta de loja, a Shopee acrescenta `code` e `shop_id`; por conta principal, `code` e `main_account_id`. O código é de uso único e expira em 10 minutos. A conta principal pode autorizar várias lojas; não tratar `main_account_id`, `merchant_id` e `shop_id` como a mesma identidade. Para a primeira implementação de uma loja por conexão, usar o caminho de loja e validar o `shop_id` antes de persistir a conexão.

## 2. Hosts, assinatura e tokens

Fontes oficiais: [Get Access Token](https://open.shopee.com/documents/v2/v2.public.get_access_token?module=104&type=1), [Refresh Access Token](https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=104&type=1) e o Developer Guide acima. A tabela oficial de Get Access Token foi obtida pelo leitor também com `module=87`; o nome da operação é `v2.public.get_access_token`, e o caminho HTTP é diferente do nome.

| Operação | Método e caminho HTTP |
| --- | --- |
| Trocar código por tokens | `POST /api/v2/auth/token/get` |
| Renovar tokens | `POST /api/v2/auth/access_token/get` |
| Listar pedidos | `GET /api/v2/order/get_order_list` |
| Detalhar pedidos | `GET /api/v2/order/get_order_detail` |
| Consultar loja | `GET /api/v2/shop/get_shop_info` |

Hosts publicados para as APIs: Brasil `https://openplatform.shopee.com.br`; Global `https://partner.shopeemobile.com`. Um seletor servidor BR/GLOBAL com allowlist desses hosts e BR como padrão é compatível com o contrato. Não aceitar host arbitrário enviado pelo navegador.

Trechos exatos do guia:

> “Concatenate the API path (without host) and the common parameters below into a single sign base string in the following order:”
>
> “For Shop APIs: partner_id, api path, timestamp, access_token, shop_id”
>
> “For Merchant APIs: partner_id, api path, timestamp, access_token, merchant_id”
>
> “For Public APIs: partner_id, api path, timestamp”
>
> “Use HMAC-SHA256 to hash the sign base string, and use the partner key as the encryption key. The hexadecimal all-lowercase hash value is the authentication signature.”

Concatenar sem separadores. Assinar o caminho completo `/api/v2/...`, sem host ou query. `timestamp` é em segundos e válido por cinco minutos; o exemplo oficial usa `int(time.time())`. Troca e renovação são Public APIs: não incluir `access_token/shop_id` na base da assinatura. `partner_id/timestamp/sign` seguem na query. Body da troca: `code`, `partner_id` e o identificador de autorização; body da renovação de loja: `refresh_token`, `partner_id`, `shop_id`.

Tokens e erros chegam no topo do JSON, não em `response`. O sucesso vem com `error` vazio. O nome publicado da duração é **`expire_in`**, em segundos, não `expires_in`. `access_token` dura até quatro horas; `refresh_token` dura 30 dias e a renovação retorna um novo par. O guia exige guardar esse novo refresh token para a próxima chamada e separar credenciais por loja/merchant. O refresh token só pode ser usado uma vez por identidade. Renovação concorrente precisa ser serializada por conexão e persistida atomicamente, protegendo contra troca da loja durante a renovação.

O guia fornece um exemplo realista de `expire_in: 14400`. Um exemplo de outra página mostra `expire_in: 1767001812`, incompatível com a própria descrição de duração de quatro horas. Usar a definição do campo e validar duração positiva plausível; não interpretar esse exemplo inconsistente como epoch de expiração.

A troca por conta principal retorna `shop_id_list/merchant_id_list`. O exemplo de troca por uma loja no guia não contém `shop_id` nem lista: a API pode omiti-los na primeira resposta. A renovação de loja contém `shop_id`. Validar qualquer ID retornado contra o ID solicitado, e validar a autorização efetiva com uma Shop API assinada para esse ID. Não exigir que o primeiro JSON sempre tenha `shop_id`.

## 3. Listagem e detalhe

Fontes oficiais: [Get Order List](https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1) e [Get Order Detail](https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1).

`get_order_list`: `time_range_field=create_time` ou `update_time`; `time_from/time_to` em timestamp; janela máxima **15 dias**; `page_size` entre **1 e 100**; `cursor` opcional. A resposta vem em `response`, com `order_list`, `more` e `next_cursor`. Trecho:

> “If more is true, you should pass the next_cursor in the next request as cursor. The value of next_cursor will be empty string when more is false.”

Para sincronização incremental, buscar por `update_time`, percorrer todas as páginas e usar uma pequena sobreposição com deduplicação. O limite interno de páginas deve produzir indicação de sincronização incompleta; não declarar sucesso completo descartando `more=true`.

`get_order_detail`: `order_sn_list` é uma string com IDs separados por vírgula, de **1 a 50 pedidos**. Solicitar explicitamente `item_list,pay_time,total_amount,payment_method,estimated_shipping_fee,actual_shipping_fee,actual_shipping_fee_confirmed,package_list` e outros campos realmente usados em `response_optional_fields`. O retorno é `response.order_list`; campos omitidos não são zero ou confirmação de pagamento. A leitura oficial pelo leitor expôs integralmente os campos de resposta; esses limites e a lista de campos opcionais de request foram corroborados no [schema espelhado pelo SDK independente](https://github.com/congminh1254/shopee-sdk/blob/0d38ec6c20587e7b4d60c7f28af98361679dba01/schemas/v2.order.get_order_detail.json#L303) e no cliente EcomPHP.

## 4. Identidade, variações e valores

Trechos oficiais de Get Order Detail:

| Campo | Definição publicada e consequência |
| --- | --- |
| `item_id` | “Shopee's unique identifier for an item.” Identidade do anúncio. |
| `item_sku` | SKU definido pelo vendedor, “sometimes called parent SKU”. Não distingue sozinho as variações. |
| `model_id` | “ID of the model that belongs to the same item.” A documentação apresenta amostra `0`. Preservar o valor recebido como identidade. |
| `model_sku` | SKU do vendedor para um modelo, como tipo, tamanho e cor. Pode ser vazio. |
| `model_quantity_purchased` | Quantidade comprada da linha. |
| `model_discounted_price` | Preço unitário após desconto; em bundle deal pode retornar **0 por projeto**, pois o desconto não é distribuído por item/modelo. |

Não substituir `model_discounted_price=0` automaticamente por `model_original_price`: isso inventaria receita em bundles. O próprio documento orienta chamar GetEscrowDetails para preço descontado de item nesses casos. Vincular produtos por conta + `item_id` + `model_id`; SKU ajuda o vendedor a reconhecer o vínculo, mas não deve ser a única identidade. IDs numéricos devem manter precisão exata; conversão para `Number` precisa verificar inteiro seguro.

`total_amount`: “The total amount paid by the buyer for the order”, incluindo preço dos itens, frete pago pelo comprador e ajustes por promoções Shopee. Só retorna depois do pagamento. `estimated_shipping_fee` é estimativa de custo logístico; `actual_shipping_fee` é custo logístico, com `actual_shipping_fee_confirmed` separado. **Nenhum deles é automaticamente frete cobrado do cliente ou desconto comercial.**

Se a primeira etapa não consulta escrow, guardar o total reportado separadamente; deixar frete/descontos/taxas comerciais sem comprovação como desconhecidos. Uma divergência entre itens e total precisa de revisão, não uma correção artificial com taxa, frete ou desconto inventado. Enviar zero técnico ao modelo canônico deve ser identificado como decomposição ainda não obtida e bloquear confirmação quando houver divergência.

## 5. Prazo exato, fuso e pagamento

Trechos oficiais de Get Order Detail:

> `ship_by_date` — tipo `timestamp`, exemplo `1608103685`: “Return by default. The deadline to ship out the parcel.”
>
> `days_to_ship` — tipo `int32`: “Return by default. Shipping preparation time set by the seller when listing item on Shopee.”
>
> `pay_time` — tipo `timestamp`: “The time when the order status is updated from UNPAID to PAID. This value is NULL when order is not paid yet.”

`ship_by_date` fornece o instante de despacho. Converter os segundos recebidos para um instante ISO/UTC sem somar deslocamento de fuso; exibir no fuso do usuário. O portal consultado não especifica nesse campo um fuso comercial local adicional. A leitura em segundos é corroborada pelos exemplos de timestamp e pelo SDK que converte `new Date(value * 1000)`. Não arredondar para meia-noite, fim do dia ou horário presumido de coleta. `edt_from/edt_to`, disponíveis no Brasil, são **estimativas de entrega**, não prazo de despacho.

Se `ship_by_date` estiver ausente, zero ou inválido, deixar o prazo pendente. **Não calcular `pay_time + days_to_ship × 24h`.** Fontes oficiais internacionais demonstram que calendários e regras variam:

- [Shopee SG: FAQs on shipping deadlines](https://seller.shopee.sg/edu/article/15847/shipping-deadline-faq): exclui dias não úteis; um pedido com produtos de DTS diferentes segue o maior DTS; recomenda ordenar “Ship-By-Date (Oldest First)”.
- [Shopee MY: FAQs on shipping deadlines](https://seller.shopee.com.my/edu/article/16574/shipping-deadline-faq): exclusão de fins de semana depende da categoria de vendedor, há feriados e regras por estado; o artigo inclui exemplo de segunda-feira às 11:59 PM e possíveis extensões excepcionais. **Essa hora/regra malaia não deve ser transferida para o Brasil.**

`pay_time` comprova pagamento do comprador no canal, não repasse ao vendedor. Preservar ainda `cod`, status bruto e pendências. Não transformar indiscriminadamente todo pedido não cancelado em pago/liberável.

## 6. Estados e repasses não são etapas internas da fábrica

O filtro oficial de listagem publica `UNPAID/READY_TO_SHIP/PROCESSED/SHIPPED/COMPLETED/IN_CANCEL/CANCELLED/INVOICE_PENDING`; `request_order_status_pending=true` habilita `PENDING`. O detalhe informa `pending_terms` (`SYSTEM_PENDING`, `KYC_PENDING`, `ARRANGE_SHIPMENT_PENDING`) e `pending_description`. SDKs públicos trazem ainda outros estados, mas eles não são prova de um contrato uniforme para todas as lojas brasileiras.

Preservar status bruto. Mapear estados conhecidos de forma conservadora: `UNPAID` não pago; `CANCELLED` cancelado; `IN_CANCEL` cancelamento em andamento e revisão; `SHIPPED` enviado no canal; `COMPLETED` concluído no canal. Não tratar `PROCESSED` como impressão concluída, nem `COMPLETED` como recebimento financeiro conciliado. Desconhecidos, pendências e conflito com a produção interna devem produzir revisão explícita.

Fonte oficial financeira: [Get Escrow Detail](https://open.shopee.com/documents/v2/v2.payment.get_escrow_detail?module=97&type=1).

> `escrow_amount`: “The total amount that the seller is expected to receive for the order and will change before order is completed.”
>
> `buyer_total_amount`: “The snapshot value of total amount that paid by buyer at checkout moment.”

Escrow inclui comissão, serviços, transações, frete, subsídios, tributos e outros ajustes. É separado do total do comprador e ainda pode variar. Primeira sincronização de pedidos não concilia repasse, não cria baixa de título e não confirma taxas. A data de vencimento financeiro informada pelo usuário continua sendo uma escolha operacional até existir fonte oficial de repasse conciliada.

## 7. Corroboração secundária com commits fixos

São SDKs independentes, não publicados pela Shopee; usados como verificação adicional, não substituição das fontes oficiais:

- [EcomPHP: assinatura e hosts BR/Global](https://github.com/EcomPHP/shopee-php/blob/c6210a7b79b10c842bf90f153f86c1877578757b/src/Client.php#L295); [troca e renovação](https://github.com/EcomPHP/shopee-php/blob/c6210a7b79b10c842bf90f153f86c1877578757b/src/Resources/Authorization.php#L46); [autorização legada](https://github.com/EcomPHP/shopee-php/blob/c6210a7b79b10c842bf90f153f86c1877578757b/src/Auth.php#L48).
- [congminh1254: hosts](https://github.com/congminh1254/shopee-sdk/blob/0d38ec6c20587e7b4d60c7f28af98361679dba01/src/schemas/region.ts#L9); [autorização nova com state](https://github.com/congminh1254/shopee-sdk/blob/0d38ec6c20587e7b4d60c7f28af98361679dba01/src/sdk.ts#L151); [assinatura Shop e Public](https://github.com/congminh1254/shopee-sdk/blob/0d38ec6c20587e7b4d60c7f28af98361679dba01/src/fetch.ts#L194); [timestamps em segundos](https://github.com/congminh1254/shopee-sdk/blob/0d38ec6c20587e7b4d60c7f28af98361679dba01/src/fetch.ts#L168); [schema do prazo](https://github.com/congminh1254/shopee-sdk/blob/0d38ec6c20587e7b4d60c7f28af98361679dba01/schemas/v2.order.get_order_detail.json#L478); [schema da loja](https://github.com/congminh1254/shopee-sdk/blob/0d38ec6c20587e7b4d60c7f28af98361679dba01/schemas/v2.shop.get_shop_info.json#L303).
- [QuoVadis86: tipos independentes de pedido com ShipByDate/PayTime e IDs de variação](https://github.com/QuoVadis86/shopee-sdk/blob/8e761b82d8d0a6d2767df1ecb92e5f632e0b75e3/order.go#L66).

Fonte oficial adicional, obtida integralmente após nova leitura: [Get Shop Info](https://open.shopee.com/documents/v2/v2.shop.get_shop_info?module=92&type=1). `get_shop_info` tem resposta top-level com `shop_name`, `region`, `status`, `auth_time`, `expire_time`; não exigir `response` wrapper nem `shop_id` principal no corpo. O documento oficial confirma status de loja `NORMAL/BANNED/FROZEN` e apresenta JSON de sucesso sem `shop_id` principal. A autorização já vincula a Shop API ao `shop_id` solicitado pela assinatura e token. Para uma implementação focada em vendedores brasileiros, conferir `region=BR`, status da loja e validade da autorização, sem confundir região com `merchant_id`.
