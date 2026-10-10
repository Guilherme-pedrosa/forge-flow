# Marketplaces e expedição para o Forge & Flow

Pesquisa realizada em 10/10/2026. Escopo: Mercado Livre Brasil, Shopee Brasil, TikTok Shop Brasil e referências operacionais de Bling/Olist. Sem acesso às contas de vendedor, sem alteração em sistemas externos e sem comprovação por chamadas autenticadas às APIs. O objetivo é definir o que o ERP precisa representar e quais integrações podem sustentar a operação.

## Conclusões para o produto

1. O ERP deve importar a venda, resolver o SKU, reservar estoque e identificar a falta de peças automaticamente. A equipe deve receber a próxima ação concreta: produzir, separar, montar, embalar ou despachar.
2. O prazo da produção nasce do compromisso de despacho de cada envio. Não existe regra universal de três dias. Calendário, modalidade logística, horário de corte, local do armazém e alterações da plataforma importam.
3. Produto fabricado, kit comercial, anúncio e carrinho são coisas diferentes. Um produto 3D feito em três placas continua sendo um SKU acabado; suas peças e placas pertencem à estrutura de fabricação. Um kit comercial pode reunir vários desses SKUs. Um pack do Mercado Livre agrupa pedidos para a compra/envio e não descreve a fabricação.
4. Estoque físico pronto, componentes disponíveis, filamento disponível e capacidade futura de impressão são saldos diferentes. Publicar toda a capacidade teórica de fabricação como estoque imediato aumenta a exposição a atrasos.
5. Marketplace não deve ser o cadastro mestre de receitas de fabricação. A composição técnica precisa existir dentro do Forge & Flow e sobreviver à troca de canal.
6. Entrada rápida por webhook exige recuperação por consulta, idempotência e reconciliação. Um webhook perdido não pode significar uma venda perdida; um repetido não pode consumir filamento ou reservar peças novamente.
7. Financeiro precisa distinguir receita da venda, valores estimados a receber, taxas efetivas, estornos, recebíveis liberados e dinheiro recebido no banco. Valor bruto do pedido não é margem nem caixa.

Os itens acima são recomendações de desenho a partir das capacidades documentadas abaixo, não promessas de funcionalidade já existente no Forge & Flow.

## Qualidade e limite das evidências

- **Documento oficial lido integralmente:** política de logística do TikTok Shop Brasil; documentação de webhooks do Bling; algumas páginas de ajuda dos ERPs.
- **Trechos indexados de documentação oficial:** grande parte da documentação Mercado Livre e referências de APIs do TikTok Shop. As páginas do Mercado Livre retornaram 403 na abertura direta; o Partner Center TikTok retornou páginas dependentes de JavaScript, embora a busca expusesse trechos do documento oficial.
- **Não confirmado na fonte primária nesta sessão:** campos, limites, assinatura, retentativas e permissões efetivas da Shopee Open Platform. `open.shopee.com` retornou 403. Links de APIs abaixo são uma lista de validação, não um contrato já verificado.

Foram encontrados espelhos, bibliotecas não oficiais e notícias. Serviram apenas para localizar referências e levantar perguntas. Não sustentam as regras técnicas finais. Nenhuma tarifa fixa foi adotada.

## Mercado Livre Brasil: capacidades e consequências

### Pedidos, carrinho e envio

A documentação oficial expõe leitura de pedido por `GET /orders/{order_id}`; itens podem trazer `item.id`, `variation_id`, `seller_sku`, quantidade, preço e `sale_fee`. Há estados de pagamento e cancelamento. Um pack pode relacionar um ou mais pedidos e deve ser buscado por sua entidade própria. Não tratar o número do carrinho como número único da linha de venda. [Pedidos](https://developers.mercadolivre.com.br/devcenter/gerenciamento-de-vendas), [Packs](https://developers.mercadolivre.com.br/pt_br/gestao-packs).

A integração deve conservar `order_id`, `pack_id`, `shipment_id` e IDs das linhas separadamente. Cancelar um pedido não implica que todo o pack tenha sido cancelado. Antes de criar demanda de produção, confirmar o estado utilizável da venda e as quantidades vigentes. O título do anúncio deve ser informação visual, não chave de associação.

### Prazo de despacho

`GET /shipments/{shipment_id}/sla` informa data/hora máxima de despacho em `expected_date`, estado do SLA e serviço. A documentação registra depreciação de `estimated_handling_limit` em 13/05/2025; novos desenvolvimentos devem consumir o recurso de SLA. A informação de entrega ao comprador é outra coisa. As notificações de `shipments` são relevantes para atualizar o prazo e o estado. [Envios](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios).

Para a farm, salvar a data exata, seu fuso, a origem e a última atualização. Transformá-la em prazo interno descontando montagem, acabamento, embalagem e a coleta real da empresa. Se a API não conseguir calcular o prazo, exibir a exceção; não preencher silenciosamente com três dias.

O Mercado Livre também documenta `MANUFACTURING_TIME` em `sale_terms` para disponibilidade futura de estoque, com validação por categoria. Isso pode apoiar anúncios elegíveis sob encomenda, mas sua utilização exige confirmar a modalidade, a categoria e o comportamento do pedido real. Não garante que qualquer SKU ou logística aceite prazo de fabricação. [Sincronização de publicações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes).

### Notificações e recuperação

A documentação orienta confirmar recebimento HTTP 200 rapidamente e buscar o recurso referenciado. Há retentativas e `GET /missed_feeds?app_id=...`; o histórico de notificações perdidas dura apenas dois dias. Para `items`, a documentação exige `site_id`. O trecho oficial em inglês recomenda resposta em até 500 ms. Portanto, gravar e enfileirar antes de realizar chamadas externas ou ações de produção. [Notificações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-receba-notificacoes), [recomendação de tempo de resposta](https://developers.mercadolivre.com.br/en_us/products-receive-notifications).

Consulta por janela de alteração e reconciliação independente continuam necessárias: uma indisponibilidade longa supera o histórico de `missed_feeds`. Mensagens repetidas são normais e o estado completo deve ser obtido da API.

### SKU, variações, User Products e depósitos

O Mercado Livre documenta variações com IDs próprios e atributo `SELLER_SKU`; `seller_custom_field` não deve substituir o modelo de identidade. A leitura com `include_attributes=all` importa em alguns cenários. [Variações](https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos/variacoes).

Novos desenvolvimentos de publicação devem considerar User Products. A gestão atual pode usar `user_product_id` e estoque por origem/depósito, com `GET /user-products/{id}/stock`. Estoque em Full tem tratamento próprio e não pode ser aumentado por uma simples escrita do saldo do seller. Confirmar a disponibilidade das operações por conta/site/modalidade. [Publicar produtos](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/publicacao-de-produtos), [Estoque multi-origem](https://developers.mercadolivre.com.br/pt_br/estoque-multi-origem), [Gestão multiorigem / User Products](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/gestao-de-estoque-multiorigem-user-products).

Consequência: uma tabela de vínculo precisa guardar canal, conta, anúncio, variação/SKU externo, User Product quando aplicável, depósito e SKU interno. Não vincular somente por descrição nem somente por `item_id`.

### Kits comerciais

A documentação de kits virtuais, atualizada em 17/09/2026, descreve estoque calculado a partir dos componentes. Há elegibilidade de componentes, de dois a seis produtos diferentes por kit e até dez unidades de cada componente. A composição publicada é imutável, embora condições de venda possam mudar. Habilitação de testes tem tratamento específico para parceiros não certificados. [Kits virtuais](https://developers.mercadolivre.com.br/pt_br/kits-virtuais).

Essa entidade não equivale à lista de peças internas de um modelo 3D. Uma luminária com base, corpo e difusor impressos em placas distintas pode ser vendida como um único produto, sem virar kit virtual. O ERP precisa representar os dois casos e evitar a baixa duplicada quando o canal já entrega os componentes de um kit na venda.

### Etiqueta, logística e pós-venda

Mercado Envios 2 documenta obtenção de etiquetas por `shipment_labels`, incluindo PDF e ZPL2. Elegibilidade/disponibilidade dependem do estado e do tipo do envio. [Mercado Envios 2](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/mercado-envios-2).

Existem APIs de reclamações e devoluções no domínio `post-purchase`, com ações e resoluções dependentes do estado. Isso permite importar pendências e acompanhar consequências comerciais, mas não autoriza automatizar todos os reembolsos sem política operacional definida. [Gerenciar reclamações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/gerenciar-reclamacoes).

No ERP, separar produto concluído, controle de qualidade aprovado, pacote pronto, etiqueta disponível, etiqueta impressa, entrega ao transportador e confirmação do canal. Devolução deve voltar inicialmente para inspeção; só itens aprovados retornam ao estoque vendável.

### Financeiro e autenticação

Relatórios de faturamento permitem consultar encargos e documentos por período/grupo ML ou MP, além de gerar relatórios de conciliação. A própria documentação distingue cobranças, bonificações e devoluções. Importar `sale_fee` do pedido é útil, mas insuficiente para chamar um valor de lucro final ou saldo bancário recebido. [Relatórios de faturamento](https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/relatorios-de-faturamento), [Boas práticas de conciliação](https://developers.mercadolivre.com.br/pt_br/boas-praticas-para-o-consumo-das-apis-de-relatorios-de-faturamento).

Autorização utiliza fluxo de código e tokens; revogação invalida credenciais. O refresh token é de uso único, exigindo atualização transacional e exclusão mútua entre workers. PKCE precisa ser respeitado quando habilitado. Aplicações Mercado Livre e Mercado Pago são separadas; não assumir que um token concedido para um cobre todos os recursos do outro. [Autenticação e autorização](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao), [Desenvolvimento in-house](https://developers.mercadolivre.com.br/devcenter/desenvolvimento-in-house).

## Shopee Brasil: viabilidade comprovada e validações necessárias

### O que as fontes oficiais permitem afirmar

A ajuda Shopee Brasil usa DTS — Dias Para Enviar — e orienta consultar a data de envio do próprio pedido. A preparação, a coleta/postagem e a entrega são etapas diferentes. [Cancelamento automático](https://help.shopee.com.br/portal/4/article/76324-%5BCancelamento%20do%20pedido%5D%20Por%20que%20meu%20pedido%20foi%20cancelado%20automaticamente%20pela%20Shopee%3F), [Prazo de envio e entrega](https://help.shopee.com.br/portal/4/article/223979-Como-funciona-o-prazo-de-envio-e-entrega-do-seu-pedido-%F0%9F%93%A6).

Páginas oficiais brasileiras consultadas por busca apresentam descrições distintas de prazo: uma menciona até dois dias úteis para itens normais e sete a trinta dias corridos em pré-encomendas; a alteração de prazo possui página própria no Centro do Vendedor, cujo corpo não pôde ser lido nesta sessão. Essas páginas não sustentam uma regra única atual para a conta de Gleyce. [Reembolso de pedidos cancelados](https://help.shopee.com.br/portal/4/article/76320-%5BCancelamento-de-pedidos%5D-Como-vou-receber-meu-reembolso-por-pedidos-%3Cem%3Ecancelados%3C%2Fem%3E?previousPage=search+results+page), [Mudança de prazo de envio](https://seller.shopee.com.br/edu/article/20542/mudanca-prazo-envio).

A documentação operacional do Bling comprova que sua integração associa produtos Shopee por SKU e por ID do produto/variante e permite atualização de estoque/preço. A documentação do Olist comprova importação de pedidos/produtos e sincronização de estoque em sua própria integração. Isso demonstra viabilidade operacional, mas não valida sozinho contrato, limites ou aprovação de um app próprio. [Bling: vínculo manual](https://ajuda.bling.com.br/hc/pt-br/articles/4414430496791-V%C3%ADnculo-manual-de-produtos-da-Shopee), [Olist: integrar Shopee](https://ajuda.olist.com/marketplaces-shopee/como-integrar-com-a-shopee).

### APIs candidatas a verificar antes de estimar a implementação

A abertura da documentação oficial Shopee retornou 403. A lista abaixo é um roteiro para validação autenticada. Confirmar disponibilidade Brasil, perfil de parceiro, categoria do app, escopos, assinatura, janela de consulta, paginação, estados e campos efetivamente devolvidos.

| Necessidade | Referência oficial a validar |
|---|---|
| Onboarding e autorização Brasil | [Jornada do Desenvolvedor Brasil](https://open.shopee.com/developer-guide/736), [Developer Guide](https://open.shopee.com/developer-guide/4) |
| Pedido e deadline | [v2.order.get_order_detail](https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1), [v2.order.get_order_list](https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1) |
| Push de mudanças | [Push Mechanism / guia](https://open.shopee.com/developer-guide/16) |
| Estoque | [v2.product.update_stock](https://open.shopee.com/documents/v2/v2.product.update_stock?module=89&type=1) |
| Preparação logística | [v2.logistics.get_shipping_parameter](https://open.shopee.com/documents/v2/v2.logistics.get_shipping_parameter?module=95&type=1), [v2.logistics.ship_order](https://open.shopee.com/documents/v2/v2.logistics.ship_order?module=95&type=1) |
| Documento de envio | [v2.logistics.create_shipping_document](https://open.shopee.com/documents/v2/v2.logistics.create_shipping_document?module=95&type=1), [v2.logistics.download_shipping_document](https://open.shopee.com/documents/v2/v2.logistics.download_shipping_document?module=95&type=1) |
| Valores efetivos do pedido | [v2.payment.get_escrow_detail](https://open.shopee.com/documents/v2/v2.payment.get_escrow_detail?module=97&type=1) |
| NF-e Brasil | [Guia oficial de subida de NF-e](https://open.shopee.com/developer-guide/382) |

Campos como `ship_by_date`, `days_to_ship`, `item_id` e `model_id` são candidatos conhecidos para o contrato, mas precisam ser confirmados no payload atual do app aprovado. Não transferir regras de Taiwan, Filipinas, Singapura ou operação cross-border para o seller Brasil. O esquema normalizado do ERP deve tolerar dados pessoais mascarados e diferenças conforme o estado do pedido.

## TikTok Shop Brasil: integração com requisitos locais

### Prazos e calendário comprovados

A política oficial brasileira de 17/07/2026 recomenda pronto para envio em um dia útil e exige despacho/coleta em até dois dias úteis para vendedores locais, tanto no envio da plataforma quanto no do vendedor. Documenta cancelamento automático quando o pedido não entra em enviado após seis dias úteis. O corte é 23:59:59 local/UTC−3. Sábados, domingos e feriados reconhecidos ficam fora da contagem; feriados estaduais/municipais dependem da localização do armazém. O status de despachado corresponde à posse do transportador, não à impressão da etiqueta. [Política de logística Brasil](https://seller-br.tiktok.com/university/essay?knowledge_id=1444948508280592&lang=en).

Para o Forge & Flow, estes são limites da política consultada, não constantes permanentes. Atualizações e prazos específicos por pedido devem prevalecer. A agenda de impressoras pode operar à noite e aos fins de semana; isso não transforma o calendário de coleta em calendário 24/7.

### Pedidos, fiscal e expedição

A atualização oficial do mercado brasileiro prevê `need_upload_invoice`, dados para emissão fiscal, Upload Invoice, documento `INVOICE_LABEL` em A6 e webhook de mudança do estado da NF. A validação fiscal faz parte do caminho de expedição do Brasil. [Fluxo Brasil de pedidos, NF e armazéns](https://partner.tiktokshop.com/docv2/page/br-market-updated-api-workflow-to-support-order-invoice-and-warehouse).

O documento de transporte da plataforma é obtido por pacote, após a etapa indicada no fluxo Ship Package; existem formatos e documentos específicos por mercado. [Get Package Shipping Document](https://partner.tiktokshop.com/docv2/page/get-package-shipping-document).

O guia OMS exige tratar o período On Hold e outros casos como amostras/brindes, além de distinguir sincronização de pedido da coordenação de fulfillment. Não liberar automaticamente uma produção sob encomenda para pedido ainda bloqueado, sem antes confirmar comportamento do Brasil e política de reserva. [Requisitos de OMS](https://partner.tiktokshop.com/docv2/page/order-management-system-oms).

### Estoque, eventos, financeiro e app

Update Inventory atualiza quantidades de SKUs de um produto, com condições de estado e contexto de armazém; a escrita não é apenas um inteiro global de produto. [Update Inventory](https://partner.tiktokshop.com/docv2/page/update-inventory).

O SDK oficial documenta chamadas autenticadas e configuração separada de webhooks em Partner Center ou Events API; um SDK não instala o receptor de eventos. [SDK e configuração de webhooks](https://partner.tiktokshop.com/docv2/page/tts-api-sdk-overview). Os detalhes de assinatura, retentativas e enumeração de eventos devem ser confirmados nestas referências antes de implementação: [Configuration guide](https://partner.tiktokshop.com/docv2/page/configuration-guide), [Get Shop Webhooks](https://partner.tiktokshop.com/docv2/page/get-shop-webhooks), [Update Shop Webhook](https://partner.tiktokshop.com/docv2/page/update-shop-webhook). Nesta sessão seus corpos oficiais completos não ficaram acessíveis; não se adota uma agenda de retries apenas porque bibliotecas de terceiros a reproduzem.

Get Transactions by Order, versão 202501, retorna transações por SKU abrangendo venda, taxas, comissão, frete, impostos e reembolsos; requer `seller.finance.info`. Get Payments teve versão 202605 publicada para reconciliação de pagamentos e possui restrições por região. Confirmar acesso efetivo da loja Brasil. [Transações do pedido](https://partner.tiktokshop.com/docv2/page/get-transactions-by-order), [Pagamentos 202605](https://partner.tiktokshop.com/docv2/page/get-payments-202605).

A categoria Enterprise Resource Planning cobre workflows de produto, estoque, pedidos, fulfillment e conciliação. Categoria, mercado e escopos determinam o caminho de desenvolvimento/revisão; não estimar que cadastrar o app equivale a estar apto a operar com sellers reais. [Matriz de categorias](https://partner.tiktokshop.com/docv2/page/hulvi36o). Revisão de app, autorização, tokens e acesso de retorno/reembolso Brasil devem ser testados antes da promessa comercial de um conector completo.

## O que aprender de Bling e Olist sem copiar toda sua burocracia

| Evidência operacional | Fonte e consequência |
|---|---|
| Vínculo de produto precisa manter SKU e IDs de canal | [Bling: produtos Shopee](https://ajuda.bling.com.br/hc/pt-br/articles/360056426734-Produtos-da-Shopee-Informa%C3%A7%C3%B5es-Gerais). O ERP pode sugerir vínculos uma vez e pedir intervenção apenas para conflito/SKU desconhecido. |
| Importação não preserva necessariamente composição industrial | [Bling: importação ML](https://ajuda.bling.com.br/hc/pt-br/articles/4414530413463-Importa%C3%A7%C3%A3o-de-produtos-do-Mercado-Livre). Produto com composição pode entrar como simples; a receita técnica deve ter cadastro independente. |
| Status externo e status interno precisam de mapeamento | [Bling: pedidos Shopee](https://ajuda.bling.com.br/hc/pt-br/articles/360058449833-Pedidos-de-venda-da-Shopee). No Forge & Flow, pago, reservado, em impressão, pronto e despachado devem ser campos/estados com significado claro. |
| Separação pode explodir kits e agrupar por logística | [Bling: picking](https://ajuda.bling.com.br/hc/pt-br/articles/14923712469527-Como-gerar-relat%C3%B3rio-de-separa%C3%A7%C3%A3o-de-vendas-no-Bling). A tarefa de embalar pode agrupar pedidos da mesma coleta sem perder o vínculo de peças e SKUs. |
| Taxas podem entrar automaticamente e variar entre pedidos | [Bling: taxas de marketplaces](https://ajuda.bling.com.br/hc/pt-br/articles/8930132309911-Como-configurar-as-taxas-de-marketplaces-nas-vendas), [Margem por Pedido](https://ajuda.bling.com.br/hc/pt-br/articles/35658275718551-Dashboard-Margem-por-Pedido). Comparar margem prevista com realizada, em vez de manter uma taxa universal. |
| Kit e fabricado merecem tratamentos distintos | [Olist: módulo de produtos](https://ajuda.olist.com/produtos/modulo-de-produtos), [kits com variações](https://ajuda-solucoes.olist.com/produtos/como-trabalhar-com-kits-que-possuem-variacoes). A estrutura de um fabricado não pode virar automaticamente kit de venda. |
| Estoque de Full precisa de separação por depósito | [Olist: integração Shopee](https://ajuda.olist.com/marketplaces-shopee/como-integrar-com-a-shopee). Validar depósito exclusivo e exclusão de saldo de outros canais na configuração real. |

O Bling documenta assinatura HMAC, entrega não ordenada, IDs de evento, idempotência, eventos separados para estoque físico e virtual e retentativas de até três dias. Pode ser uma integração fiscal/comercial de apoio, com o Forge & Flow como núcleo de produção e estoque fabril. A vantagem deve ser demonstrada em operação; dois sistemas escrevendo no mesmo saldo sem autoridade definida provocam conflito. [Webhooks Bling](https://developer.bling.com.br/webhooks).

As fontes de ajuda comprovam os comportamentos descritos por esses fornecedores. Não comprovam equivalência com a operação 3D, qualidade do suporte, taxa de erro, custo total ou facilidade de uso. A alternativa “Forge & Flow de produção + ERP/hub fiscal/comercial pronto” merece ser comparada com integrações diretas, sem compromisso antecipado de trocar de produto.

## Desenho recomendado: pouco trabalho humano, controle confiável

Esta seção é proposta de arquitetura e operação, não reprodução de um fornecedor.

### Identidades e modelo mínimo

Manter ao menos: `Canal/Conta`, `Vínculo de anúncio/SKU`, `Pedido externo`, `Linha de venda`, `Pack/Carrinho`, `Pacote/Envio`, `Compromisso de despacho`, `Reserva`, `Demanda de produção`, `Peça`, `Produto acabado`, `Kit comercial`, `Transação financeira` e `Devolução/Inspeção`.

Uma linha de venda aponta para uma versão da composição interna do SKU. A explosão da demanda ocorre uma vez e considera peças/estoque disponíveis. Placas são execuções que produzem uma ou várias peças; não são a unidade de venda. Uma placa pode atender várias vendas; uma venda pode depender de várias placas. A conclusão da placa informa rendimento real e refugo, não “pedido enviado”.

### Fluxo de integração

1. Receber evento; verificar autenticidade conforme o canal; persistir o corpo e a identidade; confirmar rápido.
2. Worker busca o estado completo do recurso, conserva o payload original e atualiza o pedido normalizado.
3. Aplicar chave única por canal + conta + identidade externa. Atualizações repetidas não recriam reservas nem movimentos.
4. Reservar estoque acabado e componentes aprovados em transação. Explodir somente a falta em demanda de fabricação.
5. Calcular necessidade de placas/tempo/material e a conclusão possível até o prazo interno; alertar exceções.
6. Atualizar saldos vendáveis dos canais por uma fila de saída persistente. Consolidar alterações do mesmo SKU para reduzir chamadas.
7. Buscar etiquetas/documentos quando elegíveis; embalar com conferência; registrar a entrega física e reconciliar o estado recebido do canal.
8. Importar taxas/recebíveis e posteriormente conciliar repasse bancário, estornos e diferença de frete.

Para mudanças fora de ordem, consultar o recurso atual e usar seu `updated_at`/versão quando disponível. Não basta um ranking linear de estados: devoluções, reembolsos e alteração de pacote são ramificações legítimas após envio. Cancelamento libera reservas não consumidas; peças já impressas podem voltar ao estoque utilizável, enquanto filamento efetivamente consumido continua como custo.

### Recuperação e operação das integrações

Programar consultas por janela de atualização com sobreposição, paginação e marca de progresso por conta. Manter reconciliação periódica de pedidos abertos, prazos, estoques publicados e recebíveis. Usar `missed_feeds` no ML como complemento. Respeitar limite/429 com backoff e aleatoriedade; rotacionar token sob lock; distinguir falta de permissão, credencial vencida, indisponibilidade e rejeição de negócio.

Mostrar à equipe apenas exceções acionáveis: SKU sem vínculo, prazo ausente, reserva insuficiente, estoque divergente, fiscal pendente ou conexão que precisa de autorização. Cada exceção precisa indicar o efeito operacional e o que resolve o bloqueio. Métricas internas: demora de importação, pedidos não reconciliados, idade da fila de atualização de estoque, operações sem confirmação e atraso de produção/expedição.

### Fila da farm e promessa de estoque

O prazo interno deve retroceder a partir da coleta/despacho: margem logística + embalagem + montagem/acabamento/controle de qualidade. A prioridade da placa depende dos pedidos/componentes que ela desbloqueia, do prazo mais próximo, do material e da impressora compatível. Agrupar material/cor reduz setup, mas só é permitido quando não compromete a entrega de pedidos urgentes.

Apresentar três quantidades: **pronto para vender**, **reservado**, **possível produzir até determinada data**. Peça em quarentena/refugada não é disponível. Para kit virtual interno, disponibilidade = mínimo inteiro entre os componentes livres divididos pelo consumo de cada um. Essa conta é simples para estoque; disponibilidade com produção futura exige capacidade finita e concorrência entre SKUs pelos mesmos materiais/impressoras.

Durante implantação, publicar saldo físico livre com proteção configurável. Expandir a venda sob encomenda apenas nos canais/categorias que aceitem o prazo e quando o cálculo de capacidade estiver comprovado. Falha de máquina, reimpressão e operação humana de retirada/troca de placa precisam entrar no compromisso.

### Margem e embalagem

Preço mínimo e margem prevista devem considerar: material da composição, perdas/purgas/suportes, tempo/custo de máquina, trabalho manual, insumos não impressos, embalagem por tamanho do pacote, impostos parametrizados com a contabilidade, taxas efetivas/estimadas do canal, frete do vendedor, descontos que o vendedor financia e provisão de retrabalho/devolução.

Peso e dimensões de frete são do produto **embalado**, não do STL nem apenas da peça. Guardar padrão de embalagem por SKU e por kit, além de medições reais. Quando o fechamento financeiro chegar, atualizar a margem realizada sem apagar a previsão original; é a comparação que revela preço insuficiente, falha recorrente e frete mal estimado.

## Validações para iniciar o desenvolvimento com segurança operacional

Este é o trabalho técnico de aceitação de conectores, não um pedido de confirmação ao usuário.

- Conferir em cada canal três pedidos reais: simples, variação e kit/múltiplos itens; preservar IDs, quantidade, pagamento, prazo, logística e valores.
- Validar autorização, refresh/revogação, escopos e acesso Brasil na categoria de app correta.
- Demonstrar evento duplicado, evento fora de ordem, indisponibilidade e recuperação por consulta sem dupla produção/baixa.
- Demonstrar atualização de saldo para SKU vendido em dois canais, inclusive componente que participa de dois kits; documentar a janela residual de venda simultânea e a política de proteção.
- Validar emissão/upload da NF e disponibilidade da etiqueta no caminho real de logística; comprovar coleta/despacho separadamente da impressão.
- Testar cancelamento antes de fabricar, depois de fabricar e depois de despachar; testar devolução parcial com inspeção.
- Conciliar um pedido concluído e um estornado, do valor bruto ao repasse, incluindo frete e taxas reais.

Primeiro objetivo de produto: a venda paga entrar sozinha e resultar em lista clara do que falta produzir até quando, com material e impressora compatíveis. Catálogo avançado, campanhas e novos marketplaces devem crescer depois que pedido → estoque → produção → expedição estiver confiável.
