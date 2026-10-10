# Pesquisa de custos, compras e financeiro para Forge & Flow

Consulta realizada em 10/10/2026. Este arquivo reúne evidência pública e propostas de domínio para o diagnóstico; não altera o ERP nem realiza compras. Valores do exemplo são hipóteses didáticas em reais, não cotações nem taxas vigentes de Mercado Livre/Shopee.

## O problema operacional que esse recorte precisa resolver

Na transcrição, a usuária descreve filamentos distribuídos em três máquinas e uma compra recente que deixou de considerar as outras máquinas; isso gera nova compra e novo frete (00:01:57–00:02:20). A recomendação central é uma visão consolidada por material/cor, com localização de cada bobina e compras já em trânsito. Um estoque mínimo cadastrado, sem consumo futuro das placas e sem visibilidade de material carregado, resolve apenas uma parte do problema.

**Proposta de domínio:** o sistema deve conduzir pedido → necessidade de produto → peças faltantes → placas necessárias → materiais/tempo → expedição → recebimento financeiro. A ação cotidiana pode ser simples enquanto os registros de estoque e custo ficam completos por baixo.

## Evidências verificadas

| Fonte primária/oficial | Achado utilizado | Limitação |
|---|---|---|
| [Prusa — 3D Printing Price Calculator](https://blog.prusa3d.com/3d-printing-price-calculator_38905/) | Importa G-code ou recebe tempo/peso; contempla preparo, pós-processamento, energia, máquina, manutenção e outros custos. | Calculadora de serviço; não modela toda a venda de marketplace nem montagem multi-placa. Valores padrão não são orçamento da empresa. |
| [Prusa — How to calculate 3D printing costs?](https://blog.prusa3d.com/how-to-calculate-printing-costs_38650/) | Material, preparação humana, operação da máquina e perdas são elementos distintos. | Artigo de 2020; preços, salários e energia do exemplo são históricos. A aproximação de margem do artigo não é uma fórmula universal. |
| [Prusa — Wipe tower](https://help.prusa3d.com/article/wipe-tower_125010) | A torre é compartilhada entre objetos e depende das trocas de cor; várias cópias podem melhorar eficiência de filamento. | Documentação de PrusaSlicer/MMU. Bambu e outros sistemas exigem leitura própria dos dados de purga. |
| [Odoo 19 — Manufacturing order costs](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/mo_costs.html) | Distingue custo planejado e real; componentes, operações, centros e mão de obra compõem o cálculo. | O HTML apresentou timeout. Foi lido o [fonte oficial da documentação](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/inventory_and_mrp/manufacturing/basic_setup/mo_costs.rst). Não implica recomendar adoção do Odoo. |
| [Odoo 19 — Reordering rules](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html) | Usa saldo previsto, mínimo/máximo e múltiplos de compra; distingue repor comprado e fabricar. | Lido também o [fonte oficial](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.rst) após falha de acesso HTML. |
| [Odoo 19 — Just in time logic](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/just_in_time.html) | Lead times e datas da demanda definem a janela de abastecimento. | Lido o [fonte oficial](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/just_in_time.rst). Compra tardia não resolve falta anterior à entrega. |
| [Odoo 19 — Landed costs, fonte oficial](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/inventory_and_mrp/inventory/inventory_valuation/landed_costs.rst) | Custos de aquisição adicionais podem ser rateados por quantidade, valor, peso ou volume. | O critério adequado depende do que originou o gasto. |
| [Microsoft — Safety stock journal](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/safety-stock-journal) | Propostas de cobertura podem usar consumo histórico, lead time, variabilidade e nível de serviço. | Parâmetros de um ERP, não validação estatística da demanda específica da empresa. |
| [NIST SP 1176 — Costs and Cost Effectiveness of Additive Manufacturing](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.1176.pdf) | Orientação, ocupação, tempo, energia e trabalho alteram o custo. | Revisão oficial de literatura de 2014, com processos industriais diversos; percentuais de custo de máquinas metálicas não se transferem para uma farm FDM atual. |
| [CPC 16 (R1), revisão 13 — Estoques](https://www.cpc.org.br/Arquivos/Documentos/243_CPC_16_R1_rev%2013_ComAVISO.pdf) | Aquisição/transformação compõem estoque; custos fixos usam capacidade normal. Ociosidade e desperdício anormal são despesas; comercialização fica fora do custo contábil do estoque. | Regras de valoração contábil, não fórmula de preço. Configuração fiscal/contábil deve refletir o regime real da empresa. |
| [Sebrae — Calculadora de Marketplace](https://to.agenciasebrae.com.br/inovacao-e-tecnologia/sebrae-tocantins-lanca-calculadora-de-marketplace-para-ajudar-empreendedores-em-2025/) | Formação de preço precisa incorporar comissão, frete e simular descontos. | Notícia de 09/12/2024; não foi usada como tabela vigente de tarifas. |
| [Mercado Pago — Usos do relatório Dinheiro em conta](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/reports/account-money/how-to-use) | Diferencia pagamentos, reembolsos, contestações, disputas, saques e transações de envio; valor líquido impacta a conta. | Esquema deve ser validado por país/conta/versão e pelo relatório realmente disponível. |
| [Mercado Pago — Campos do relatório Liberações](https://www.mercadopago.com.br/developers/en/docs/reports/released-money/report-fields) | Há identificadores, referência externa, bruto, comissão, frete, datas, reservas e devoluções. | Página internacional inclui campos tributários de outros países. Não interpretar todo TAXES_AMOUNT como imposto brasileiro sobre vendas. |
| [Odoo 19 — Bank reconciliation](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html) | Concilia transações com títulos/pagamentos e admite conciliação parcial. | Lido o [fonte oficial](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/finance/accounting/bank/reconciliation.rst). Arquitetura sugerida abaixo é inferência própria. |

## Estoques que não podem ser confundidos

**Proposta:** manter movimentos e saldos separados, com unidade explícita:

1. **Filamento:** gramas úteis de material/cor/marca/lote. Bobina é recipiente rastreável, não unidade universal de massa: existem bobinas de pesos distintos e restos carregados.
2. **Peças impressas aprovadas:** unidades por componente/variante/revisão. Uma base aprovada pode atender outro pedido compatível.
3. **Produto montado:** unidades de SKU prontas para vender/expedir.
4. **Componentes comprados:** parafusos, ímãs, LEDs etc., em unidade apropriada.
5. **Embalagens e insumos:** caixa, proteção, etiqueta, cola etc.

Imprimir uma placa consome filamento e produz peças. Montar consome peças e acessórios e produz o produto. A venda reserva produto; a expedição baixa produto. Reservar não é consumir. Não baixar de novo o filamento quando o produto for vendido: ele já saiu para a produção.

Para cada bobina: material/cor comercial + especificação técnica, fornecedor/lote, tara, peso líquido inicial, saldo estimado, última pesagem, estado (lacrada/carregada/em secagem/bloqueada), localização (estoque, impressora/AMS específico), custo e data. Pesar com tara conhecida é uma forma de corrigir o saldo estimado; registrar ajuste com motivo preserva o histórico. Telemetria e estimativa do slicer não comprovam massa física.

Separar **saldo físico útil**, **reservado**, **livre agora** e **previsto por data**. Filamento inadequado ou em quarentena não deve aparecer como disponível. Material carregado continua sendo estoque da empresa; uma transferência para AMS não é consumo. Um resto que não sustenta uma placa inteira pode ser útil se a máquina e o procedimento permitem troca durante a impressão, mas isso altera o plano e precisa ser explicitado.

## Produto, placas e custo de montagem

**Proposta:** a ficha do produto descreve o que o produto exige; o plano de placa descreve como fabricar peças; a execução descreve o que aconteceu. São três registros relacionados, versionados.

- Produto: 1 base + 2 presilhas + 1 aplique + 2 ímãs; montagem, acabamento e embalagem.
- Plano de placa A: 10 bases, material/cor, impressoras compatíveis, perfil e arquivo fatiado; tempo e massas esperados.
- Plano B: 20 presilhas; plano C: 10 apliques. A mesma peça pode ter planos alternativos de 1, 5 ou 10 unidades.
- Execução: impressora, bobinas usadas, início/fim, consumo estimado/medido, peças boas/refugadas, reimpressões e operador.

Uma placa mista pode abastecer vários produtos/pedidos. Um produto pode exigir muitas execuções de placas. A aprovação de uma placa não cria automaticamente todos os produtos: montagem e qualidade ainda podem faltar.

**Regra concreta:** quantidade montável = mínimo, entre os componentes, de piso(saldo de peças compatíveis disponíveis / quantidade exigida por produto), também limitada por acessórios. Exemplo: 8 bases, 11 presilhas, 10 apliques permitem 5 kits que exigem 1/2/1; sobram 3 bases, 1 presilha e 5 apliques. Não lançar "8 produtos prontos" porque saíram 8 bases.

## Custo por placa e rateio

As fórmulas seguintes são propostas gerenciais derivadas dos fatores verificados, não fórmulas atribuídas a um fabricante.

```text
custo_material_placa = soma por material(custo_posto_por_g × consumo_total_g)
consumo_total = massa de objetos + suportes + brim/skirt/raft + purga/torre
custo_energia = kWh da execução × tarifa efetiva R$/kWh
aproximação_energia = potência média_kW × horas × tarifa
custo_máquina = horas de ocupação relevantes × taxa da impressora
custo_humano = minutos efetivamente trabalhados / 60 × custo_hora
custo_execução = material + energia + máquina + trabalho da execução
```

Evitar somar suportes/purga outra vez quando o total informado pelo slicer já os inclui. Em purga no infill ou em objeto aproveitável, a massa tem um destino físico: classificá-la sem duplicar seu consumo. Não aplicar um adicional universal de 20% a todo objeto multicolorido; a placa fatiada é a evidência mais adequada.

Energia deve usar consumo médio medido ou kWh por execução, inclusive aquecimento e periféricos relevantes. Potência máxima da etiqueta elétrica não é consumo médio. A página oficial Bambu de consumo foi tentada, mas bloqueou acesso; por isso não adoto seu número como fato neste relatório.

Em lote homogêneo, o custo da execução divide-se entre a produção útil, respeitando as peças reaproveitadas. Em placa mista, usar:

- Material direto atribuído à peça/objeto quando identificável.
- Custos comuns de preparação, aquecimento, deslocamento, máquina e purga compartilhados por critério explícito e consistente, por exemplo tempo de extrusão estimado ou outro direcionador causal disponível.
- Gramas como aproximação de rateio de tempo apenas quando não houver dado melhor; geometria, altura, suportes e velocidade podem tornar duas peças de mesmo peso muito diferentes em tempo.
- Soma dos custos alocados = custo total alocável da placa, com tratamento explícito do resíduo de centavos. Salvar o método e a versão.

Fatiar peças isoladas para estimar seus tempos ajuda, mas a soma não precisa ser igual ao tempo da placa real. É uma base de proporção, depois normalizada ao total real. Sobras úteis vão para estoque intermediário com seu custo; não jogar todo o custo no pedido atual e depois tratá-las como gratuitas.

## Máquina, mão de obra, falhas e uso da farm

**Proposta gerencial:** taxa de máquina pode reunir recuperação de investimento, manutenção esperada e estrutura fabril, sem incluir novamente despesas contabilizadas em outro componente:

```text
taxa_reposição = (investimento instalado − valor residual) / horas produtivas normais da vida planejada
taxa_manutenção = manutenção/consumíveis planejados / horas normais do período
taxa_estrutura_fabril = parcela fabril apropriada / capacidade normal do período
taxa_máquina = soma das parcelas que a política decidiu incluir
```

Não dividir o investimento por 24 × 365 automaticamente. Manutenção, limpeza, ociosidade normal e disponibilidade real reduzem as horas comercialmente úteis. Separar desgaste por horas de depreciação/obsolescência por calendário. Para decisão de compra de mais impressoras, comparar carga vendável, gargalo de montagem/expedição, operadores e retorno de caixa; quantidade de máquinas não equivale à capacidade entregue.

**Aplicação contábil:** manter uma política própria para valoração do estoque. A reserva de reposição usada para preço não é automaticamente depreciação contábil. Registrar manutenção paga e novamente acrescentar toda a reserva como despesa duplicaria resultado. Capacidade normal é a base apropriada para o custo fixo fabril; medir ociosidade separadamente. Administração/comercialização e perdas anormais não devem inflar o estoque. [CPC 16, itens 10–16 e 21](https://www.cpc.org.br/Arquivos/Documentos/243_CPC_16_R1_rev%2013_ComAVISO.pdf).

Mão de obra é tempo ativo de preparo, retirada, limpeza, troca/secagem de bobina, inspeção, acabamento, montagem, atendimento e embalagem. Se uma pessoa acompanha dez máquinas, não cobrar sua hora cheia dez vezes. O tempo de impressão pode seguir sozinho enquanto a pessoa executa outra atividade.

Para preço esperado com probabilidade de falha p, custo de uma tentativa boa Cb e custo médio da tentativa fracassada Cf:

```text
custo esperado para um resultado bom = Cb + [p / (1 − p)] × Cf
```

Esta é uma derivação sob tentativas independentes, taxa e custo estáveis. Cb/(1−p) só é adequado ao caso simplificado Cf=Cb. Se a falha ocorre cedo, Cf pode ser muito menor. Em falha parcial, preservar peças boas e recalcular somente faltantes. Taxa de placa integral, taxa de peças refugadas e perda em gramas são métricas diferentes; aplicar as três como adicionais gerais cobraria perdas repetidamente.

No realizado, registrar o que de fato foi consumido e produzido. A provisão/seguro gerencial para preço não deve gerar uma segunda baixa de filamento ou uma despesa adicional além da perda real. Usar histórico por plano/material/impressora, com grau de confiança; não impor uma falsa precisão onde há poucos dados.

## Formação do preço de marketplace

**Proposta:** custo unitário vendável precisa somar as peças de todas as placas, acessórios, montagem, acabamento, licença comercial/modelagem quando houver, embalagem e trabalho relevante. Depois vêm canal, imposto configurado, frete efetivo pago pelo vendedor, campanhas/ads, descontos do vendedor e custo esperado de devoluções/garantia.

Devolução esperada = probabilidade × perda econômica média não recuperada: fretes, reembalagem, inspeção, taxa não devolvida, peça perdida etc., descontando valor recuperável. Não sempre o preço inteiro do produto. Danificado, recondicionável e revendável exigem destinos de estoque distintos.

Caso simples, todas as taxas percentuais incidindo na mesma base preço P:

```text
K = custo unitário + despesas de venda em R$ por unidade/pedido atribuídas
a = soma dos percentuais que incidem sobre P
P para margem gerencial m = K / (1 − a − m)
P de equilíbrio dos custos incluídos = K / (1 − a)
resultado incluído = P × (1 − a) − K
margem incluída = resultado incluído / P
markup sobre K = P/K − 1
```

Se base, faixas, teto, tarifa por pedido, frete ou desconto mudam com P, o motor precisa calcular cada regra e encontrar preço por simulação, validando a faixa final. A fórmula compacta deixa de bastar. Itens de pedido múltiplo compartilham certos gastos; não multiplicar um frete de pacote por cada item.

**Margem e markup:** custo de R$ 100, preço de R$ 150: markup 50%, margem antes de outras despesas 33,33%. Acréscimo de 20% no custo não entrega margem de 20% no preço. Separar margem de contribuição (receita menos custos/despesas variáveis) de margem após custos fabris rateados e lucro líquido. A receita recebida após comissão não torna comissão um custo inexistente.

Preço deve ser versionado por produto, variante, tamanho de lote e canal. Comparar preço técnico, preço competitivo e capacidade disponível. Um SKU que entrega pouco resultado por hora da máquina ou do operador gargalo pode consumir a farm inteira apesar de margem percentual aparente boa. Priorizar prazo prometido e contribuição do gargalo, com cuidado: faturamento por hora não é lucro por hora.

## Exemplo numérico multi-placa, conferido

Hipóteses: 10 kits; cada kit usa 1 base de 70 g, 2 presilhas de 5 g e 1 aplique de 15 g. Todo filamento custa R$ 100/kg **posto no estoque**, portanto R$ 0,10/g. Mesma taxa de máquina de R$ 1/h; energia média hipotética 0,12 kW a R$ 1/kWh; trabalho ativo R$ 30/h.

| Plano para 10 kits | Peças | Massa de produto | Suporte/brim/purga | Massa total consumida | Tempo |
|---|---:|---:|---:|---:|---:|
| A, bases | 10 | 700 g | 50 g | 750 g | 15 h |
| B, presilhas | 20 | 100 g | 8 g | 108 g | 2 h |
| C, apliques | 10 | 150 g | 60 g | 210 g | 4 h |
| Total | 40 | 950 g | 118 g | 1.068 g | 21 h |

| Componente do lote | Cálculo | Custo |
|---|---|---:|
| Filamento | 1.068 × 0,10 | R$ 106,80 |
| Máquina | 21 × 1,00 | R$ 21,00 |
| Energia | 21 × 0,12 × 1,00 | R$ 2,52 |
| Preparo, retirada e inspeção | 48 min / 60 × 30 | R$ 24,00 |
| Subtotal tentativas bem-sucedidas | soma | R$ 154,32 |
| Impressão esperada, hipótese simplificada de falha integral 5% em cada plano, incluindo seu preparo | 154,32 / 0,95 | R$ 162,44 |
| Montagem | 10 × 5 min / 60 × 30 | R$ 25,00 |
| Acessórios comprados | 10 × 2,00 | R$ 20,00 |
| Licença/modelagem rateada, hipótese gerencial | 10 × 1,00 | R$ 10,00 |
| Embalagem | 10 × 3,00 | R$ 30,00 |
| Custo total esperado de 10 kits vendáveis | soma com precisão antes de arredondar | R$ 247,44 |
| Custo esperado por kit | total / 10 | **R$ 24,7442** |

Ajuste de falha é expectativa, não acontecimento de produção. Na operação real, boas e refugadas de cada plano são lançadas separadamente. O exemplo supõe que é possível reimprimir só o plano que falhou para completar os 10 kits; não refazer os três indiscriminadamente.

Para vender um kit, hipótese de comissão percentual 16%, tributo 6%, tarifa fixa R$ 4, frete do vendedor R$ 5, publicidade atribuída R$ 2 e perda esperada de devolução R$ 0,60 (3% × R$ 20). Esses números **não são tarifas vigentes das plataformas nem alíquota aplicável à empresa**.

```text
K = 24,7442 + 4 + 5 + 2 + 0,60 = R$ 36,3442
a = 0,16 + 0,06 = 0,22
P com margem gerencial alvo 20% = 36,3442 / 0,58 = R$ 62,6624 → R$ 62,67
P de equilíbrio dos custos incluídos = 36,3442 / 0,78 = R$ 46,5951 → R$ 46,60
```

R$ 62,67 deixa aproximadamente R$ 12,54 após os custos listados, ou 20,01% do preço. Esse valor ainda suporta administração, despesas financeiras e outros gastos não incluídos; **não afirmar lucro líquido de 20%**. O exemplo já inclui máquina e licença/modelagem rateadas no custo, por isso também não chamar esse residual de contribuição clássica sem reclassificar seus componentes.

No preço de R$ 70, o residual desses mesmos custos é R$ 18,2558 (26,08%). O repasse hipotético do marketplace, se descontar apenas comissão de R$ 11,20, tarifa R$ 4 e frete R$ 5, será R$ 49,80. O tributo hipotético R$ 4,20 continua obrigação separada; não é recebido a menos por conta desse exemplo de plataforma. Repasse de R$ 49,80 não é faturamento nem lucro.

## Motor de sugestão de compras

**Proposta inicial:** um único painel de compras por fornecedor, explicando "o que falta, por qual pedido/placa, quando falta, o que já chega, quanto comprar e quanto custa com entrega". A usuária pode consolidar cores/insumos antes de emitir um pedido de compra, reduzindo fretes repetidos.

Demanda de filamento é explosão das **necessidades líquidas de fabricação**, usando os planos de placa selecionados. Deduzir produto acabado e peças intermediárias aproveitáveis antes de pedir novas impressões. Considerar suporte/purga por execução e necessidade real de composição dos lotes. Dez vendas não equivalem sempre a dez placas e um produto vendido não exige impressão quando já existe pronto.

```text
S_i(t) = físico útil inicial_i
       + recebimentos confirmados_i com chegada ≤ t
       − consumo firme ainda não realizado_i com necessidade ≤ t
       − previsão incremental líquida_i com necessidade ≤ t
```

Não subtrair reserva de novo se ela já está incluída no consumo firme. Não somar a previsão completa às vendas firmes que já a representam: consumir/reduzir a previsão por janela ou usar somente incremento. Demandas canceladas liberam reserva; compras canceladas/atrasadas alteram entradas futuras. Sugestão sem pedido aprovado não é compra em trânsito; intenção não é estoque.

Avaliar o saldo em cada data, além do total do horizonte. Entrega no dia 10 não resolve falta no dia 4. Guardar lead time comercial, dias de entrega, prazo de conferência/secagem necessário e confiabilidade observada por fornecedor/item; mostrar primeira ruptura e última data de compra viável.

Na revisão periódica a cada R dias, com reposição L dias, horizonte H=L+R:

```text
Q_bruta = máximo(0, demanda firme_H + previsão incremental_H + segurança
                   − físico útil − recebimentos válidos_H)
Q_compra = 0, quando Q_bruta=0
Q_compra = múltiplo × teto[máximo(Q_bruta, MOQ) / múltiplo], quando Q_bruta>0
```

A fórmula final dá a quantidade indicativa; o calendário deve ainda verificar se chega antes da falta. MOQ é mínimo do fornecedor; múltiplo é tamanho da embalagem/caixa (por exemplo, bobinas de 1.000 g). Não arredondar consumo para kg antes de calcular o saldo.

Na reposição contínua simples, ponto de pedido = consumo médio durante L + segurança. Para iniciar com poucos dados, segurança por dias de cobertura explicitamente escolhidos é mais auditável que estatística aparente. Com histórico adequado, uma aproximação é segurança = z × desvio padrão do consumo diário × raiz(L), sob demanda independente e lead time fixo. Lead time variável, sazonalidade, promoção e demanda intermitente pedem modelagem adicional ou quantis empíricos; escolher nível de serviço não é prever lucro. Essa fórmula estatística é proposta analítica, não transcrição de fórmula Microsoft.

### Exemplo de compra

PLA preto útil consolidado: 5.000 g, incluindo 1.500 g reservados. Consumo firme nos próximos 7 dias: 4.500 g **já incluindo essa reserva**. Previsão adicional entre os dias 8–14: 3.000 g. Compra aprovada de 2.000 g chega no dia 5. Segurança: 1.500 g. Fornecedor: L=7 dias, revisão R=7 dias, MOQ=3.000 g, múltiplo=1.000 g. Supõe-se, após análise diária, que não existe falta antes do recebimento atual no dia 5.

```text
Q_bruta = 4.500 + 3.000 + 1.500 − 5.000 − 2.000 = 2.000 g
Q_compra após MOQ e múltiplo = 3.000 g
saldo ao fim do horizonte = 5.000 + 2.000 + 3.000 − 7.500 = 2.500 g
```

Fornecedor A: 3 kg × R$ 90 + R$ 30 de entrega = R$ 300, R$ 100/kg posto. Fornecedor B: preço R$ 90/kg, mínimo 5 kg, frete R$ 40: R$ 490, R$ 98/kg posto. Se orçamento disponível for R$ 350, B exige R$ 190 a mais de caixa para poupar R$ 2/kg; A cabe no orçamento e repõe a necessidade. Comparar também prazo, qualidade e compatibilidade de cor, não só preço unitário. Se a previsão mostrar falta antes do dia 7, comprar agora no prazo regular não basta: sugerir fornecedor mais rápido, remanejamento compatível ou reprogramação, explicitando o pedido afetado.

Para orçamento, ordenar propostas por risco de prazo/ruptura, pedidos firmes afetados e contribuição protegida; expor o que ficará descoberto. O orçamento pode restringir compras; nunca deve apagar a necessidade. Agrupar entrega por fornecedor e simular limiar de frete grátis, excesso comprado, capital imobilizado e prazo. Não comprar itens sem demanda apenas porque o frete unitário cairia.

## Financeiro mínimo que evita duplicação

**Arquitetura sugerida:** manter vínculos entre eventos operacionais, títulos e movimentos de dinheiro. Ter três visões: resultado por competência, fluxo de caixa e conciliação de repasses. São leituras dos mesmos fatos, não três lançamentos independentes de receita.

| Fato | Registro gerencial | Efeito de dinheiro |
|---|---|---|
| Pedido confirmado | Compromisso, reserva e previsão de recebível | Não presumir receita realizada nem saldo bancário |
| Venda cumprida conforme política definida | Receita bruta, custo do produto vendido, despesas/taxas e recebível | Pode continuar a receber; data de reconhecimento não é automaticamente data da aprovação do pagamento |
| Plataforma liquida valores | Baixa do recebível e aplicação das deduções efetivas; saldo disponível/restrito na plataforma | Dinheiro em carteira ou banco conforme o evento real |
| Saque da carteira para banco | Transferência entre contas da empresa | Não gera nova receita |
| Compra de filamento recebida | Entrada e valoração de estoque; obrigação com fornecedor | Pagamento pode ocorrer depois |
| Pagamento ao fornecedor | Baixa da obrigação | Saída de caixa; não registrar novamente o mesmo custo como despesa |
| Filamento consumido na impressão | Transferência para produção/peças, com perda separada quando pertinente | Não gera saída bancária naquele momento |
| Devolução/estorno | Ajustes vinculados à venda e tratamento físico da mercadoria | Pode reduzir recebível, carteira ou banco; não presumir que todas as taxas são devolvidas |

Mínimo de entidades: pedido e itens; venda/documento e títulos a receber; fornecedor e títulos a pagar; carteira/conta e movimentos; lote de liquidação/repasse e linhas; taxas/custos por natureza; associações de conciliação; movimentos/valoração de estoque. Um repasse pode liquidar várias vendas e uma venda pode receber vários ajustes/repasses. Isso exige associação muitos-para-muitos com valores, não só um campo "pago" no pedido.

Campos mínimos: empresa/canal/conta, IDs externos de pedido/pagamento/repasse, data do fato, competência, vencimento, liberação esperada/real, bruto, descontos do vendedor, tarifa, comissão, frete, tributo identificado, estornos e líquido, moeda, status, origem e documento. Preservar dado bruto da importação, política/versionamento e identificador de idempotência. Reprocessar uma notificação não pode criar segunda venda, segunda taxa ou segunda baixa.

No exemplo de venda a R$ 70: faturamento bruto R$ 70; comissão R$ 11,20; tarifa R$ 4; frete R$ 5. A liquidação esperada é R$ 49,80. Reconciliar o efetivo contra o esperado, registrar diferença com natureza/documento, e permitir parcial. Um PIX de R$ 49,80 da carteira ao banco é transferência desse mesmo dinheiro. Não registrar receita R$ 70 + recebimento R$ 49,80 + transferência R$ 49,80 como faturamento R$ 169,60.

Reservas/retenções da plataforma, impostos cobrados por ela e tributos da empresa precisam de naturezas distintas. Dinheiro bloqueado continua exigindo acompanhamento separado do livre. Compra de impressora é investimento/ativo com política de despesa/depreciação apropriada; não usar compra à vista e depreciação mensal como duas despesas de mesma natureza. Essas regras decorrem da separação de fatos e são propostas de arquitetura, não promessa de integração fiscal completa.

Painel útil: saldo de caixa/carteiras livres; recebíveis previstos por data e risco; contas a pagar; necessidade de compra comprometendo caixa; margem por pedido/SKU/canal; resultado por competência; custo padrão × real de fabricação; valor em filamento/peças/acabados; perdas e ociosidade. Começar com importação/conciliação verificável é preferível a exigir preenchimento financeiro manual em cada impressão.

## Dados necessários e limites do diagnóstico

- Sem extratos, notas de compra, perfis fatiados e histórico de produção, nenhum número deste arquivo mede a rentabilidade atual da empresa.
- Para calibrar: selecionar 5–10 SKUs relevantes (inclusive multi-placa), fatiar lotes reais, cronometrar trabalho ativo, pesar consumo/amostras, registrar bom/refugo e cruzar com repasses efetivos.
- Lead time, consumo, defeitos e custo precisam de revisão quando mudar material, impressora, perfil, fornecedor ou projeto; manter história, não reescrever custos de pedidos passados ao editar o cadastro atual.
- Não se assumiu tabela vigente de Shopee/ML, regime tributário, contratos de software/modelos nem potência média de máquina específica. Cada um influencia preço e deve vir de evidência da conta/operação.
- Não foram feitos pedidos a fornecedores, conciliações externas, lançamentos contábeis ou alterações de código. O recorte é recomendação de domínio e pesquisa para o diagnóstico do produto.
