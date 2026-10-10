# Forge & Flow: auditoria de UX comercial e operação diária

Base inspecionada: `Guilherme-pedrosa/forge-flow`, commit `e737da9f6ff151eadae648308d44a5d7c39d5da2`. Análise somente de leitura do código e das migrations materializadas. Não houve acesso à interface autenticada, banco em operação, pedidos reais, métricas de uso, tempos de tarefa ou impressões físicas. Os pontos abaixo são capacidades e obstáculos verificáveis no código, não uma medição do abandono do produto.

A conversa de Gleyce delimita um problema bem mais específico que “ter um ERP completo”: pedidos de Mercado Livre, Shopee e TikTok Shop, mais vendas particulares, deveriam aparecer juntos; a fila deveria seguir o prazo de postagem com folga; ela precisa perceber a falta de filamento considerando suas três máquinas. Isso aparece entre 00:00:27 e 00:02:20 do transcript fornecido. A intenção de manter um dia de folga aparece em 00:01:28, mas deve ser configurável e validada com a operação.

**Diagnóstico:** o Forge já tem estrutura séria para vendas, estoque, componentes, montagem e financeiro. A superfície principal foi organizada por módulos de ERP; a necessidade relatada foi organizada por decisões do dia: o que precisa sair, o que devo imprimir agora, onde está o filamento e o que preciso comprar. É possível mudar essa superfície e automatizar caminhos repetitivos preservando o modelo transacional existente.

## 1. P0 — O evento que deveria iniciar a operação ainda não entra sozinho

O Mercado Livre está ligado a um `ModulePlaceholder`; o próprio texto informa que conexão automática, pedidos, taxas e recebimentos não estão disponíveis. A rota de marketplaces também é um placeholder. Não há rota comercial específica de Shopee ou TikTok Shop no `App.tsx`. Portanto, o pedido que Gleyce imagina disparando a fila automaticamente depende primeiro de digitação manual.

Evidência: [App.tsx, L103–106](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/App.tsx#L103-L106); [ModulePlaceholder.tsx, L6–8](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/ModulePlaceholder.tsx#L6-L8).

Há importação assistida de **compras** com imagens e nomes de marketplaces, inclusive Shopee e TikTok. Essa função extrai comprovantes por `parse-purchase-receipt` e gera compra/contas a pagar; ela não comprova conexão de lojas ou ingestão automática de pedidos de venda. [Compras.tsx, L491–508](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/estoque/Compras.tsx#L491-L508) e [L532–555](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/estoque/Compras.tsx#L532-L555).

Simplificação: uma caixa única de pedidos com canal, conta, identificador externo, SKU externo e SKU interno; importação idempotente; estado de pagamento/cancelamento; prazo real fornecido pelo canal; exceções de SKU sem vínculo. Um pedido válido de produto já preparado deve gerar ou atender a demanda automaticamente conforme a política do SKU. Pedidos particulares entram pela mesma caixa com formulário curto. Acesso a APIs, regras e homologação de cada canal precisam ser verificados separadamente.

## 2. P0 — “Entrega” ainda não vira “postar até”, nem uma promessa de produção viável

O formulário de venda oferece apenas `Data de Entrega`, opcional, e salva `due_date`. A fila consulta jobs ordenados por `priority` e `created_at`; seus cartões exibem prioridade e duração da impressão, mas não data limite, folga ou atraso previsto. O modelo contém `due_date` em jobs, então não é correto dizer que o sistema não guarda prazo; o problema demonstrado é que o prazo não governa a ordenação e a decisão operacional na tela analisada.

Evidência: [Pedidos.tsx, L248–250](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/comercial/Pedidos.tsx#L248-L250), [L424–429](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/comercial/Pedidos.tsx#L424-L429); [Fila.tsx, L99–107](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/planejamento/Fila.tsx#L99-L107), [L383–401](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/planejamento/Fila.tsx#L383-L401).

Simplificação: distinguir prazo externo de postagem, prazo prometido de entrega e alvo interno de produto embalado. Mostrar `Postar até 13/10 14h · embalado até 12/10 · previsão 12/10 10h`. Calcular de trás para frente usando todas as placas, dependências da montagem, acabamento, embalagem, coleta, calendários e disponibilidade real das máquinas. A ordem inicial pode ser por alvo interno mais próximo, mas a alocação precisa testar capacidade, materiais e compatibilidade. Não basta substituir o campo “prioridade” por uma data: três placas diferentes e três máquinas não são necessariamente três trabalhos paralelizáveis.

## 3. P0 — A venda rotineira obriga decisões e transições que poderiam ser automáticas

Para um SKU já preparado, o caminho comercial visível é salvar o pedido, aprovar a venda, selecionar `Produzir`, abrir a OP e `Liberar para a fila`. São **quatro mutações principais antes de o trabalho aguardar impressão**, em pelo menos duas páginas, sem contar abrir menus e diálogos. `Produzir` pede a OP e navega para sua preparação; não libera a fila sozinho nesse caminho de UI. O pedido com saldo pronto tem um caminho útil mais curto: `Atender com estoque` baixa estoque e gera recebível sem exigir composição.

Evidência: [Pedidos.tsx, L258–283](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/comercial/Pedidos.tsx#L258-L283), [L382–387](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/comercial/Pedidos.tsx#L382-L387); [Ordens.tsx, L54–59](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/producao/Ordens.tsx#L54-L59).

No fluxo guiado pela Fila, cada job depois pode exigir iniciar manualmente, enviar à qualidade com apuração e confirmar qualidade em outra superfície. A OP oferece encerramento próprio. Não se deve somar “Pronto” da venda obrigatoriamente a esse total: existem sincronização de status de jobs e encerramento de OP que podem colocar a venda pronta. O número exato de ações depende de componentes, qualidade, origem Bambu e política do produto. [Fila.tsx, L412–435](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/planejamento/Fila.tsx#L412-L435); [SQL de OP, L251–254](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/supabase/migrations/20260926050000_commercial_production_separation.sql#L251-L254).

Simplificação: `Registrar venda confirmada` deve validar o mínimo comercial e escolher automaticamente estoque, componentes disponíveis ou produção do faltante. A OP continua existindo como documento interno e histórico; revisão técnica aparece ao operador quando há alteração, personalização, arquivo inadequado ou pendência. Uma venda padrão não precisa atravessar novamente toda a preparação de um SKU validado.

## 4. P1 — O formulário permite salvar dados que faltam na próxima etapa

O cadastro de pedido aceita `Sem cliente`, vencimento vazio, produto personalizado e preço zero. Isso é válido para um rascunho, mas a aprovação posterior exige cliente, itens, valor positivo e vencimento do recebimento no banco. O operador descobre parte das exigências ao tentar avançar. Além disso, o diálogo “Novo pedido” diz “Preencha os dados do orçamento”, misturando dois documentos distintos.

Evidência: [Pedidos.tsx, L413–429](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/comercial/Pedidos.tsx#L413-L429); [sales-order.ts, L12–27](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/lib/sales-order.ts#L12-L27); [validação de aprovação, L131–135](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/supabase/migrations/20260913012000_erp_sales.sql#L131-L135).

Há assistência já útil: selecionar cliente preenche endereço, selecionar produto preenche descrição e preço, há busca por nome/SKU e cálculo de totais. [Pedidos.tsx, L185–192](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/comercial/Pedidos.tsx#L185-L192), [L212–217](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/comercial/Pedidos.tsx#L212-L217).

Simplificação: duas intenções claras, `Salvar rascunho` e `Confirmar venda`, com validação específica visível antes do envio. Em venda particular rápida, mostrar primeiro produto/variante, quantidade, prazo combinado e pagamento; recolher dados adicionais conforme retirada, envio e exigência fiscal. Cliente do marketplace, prazo e valores vêm da importação. Pagamento já recebido e repasse futuro do canal são estados distintos; não inventar um vencimento manual para contornar a modelagem financeira.

## 5. P1 — O menu e a abertura refletem departamentos, enquanto a operadora precisa de uma sequência de trabalho

A navegação tem **31 destinos em sete grupos**. A operação de produção aparece em OPs, Componentes e montagem, Impressões, Fila, Impressoras, Margens e Qualidade. Essa riqueza é útil ao especialista, mas o iniciante precisa escolher onde agir. Há também termos diferentes para o mesmo nível: o menu chama jobs de “Impressões”, a Fila aponta para jobs como “Abrir ordens e apurar custos”, e existe uma tela separada de ordens de produção.

Evidência: [navigation.ts, L3–48](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/components/shared/navigation.ts#L3-L48); [Fila.tsx, L309–311](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/planejamento/Fila.tsx#L309-L311).

O Dashboard prioriza saldo, títulos a receber/pagar, jobs em andamento e gráficos históricos. Sua consulta de pedidos pede somente `id,status`; logo essa tela não pode calcular ou mostrar quais pedidos vencem hoje. Os links nos contadores por estágio todos levam à mesma lista sem filtro no URL. [Dashboard.tsx, L29–38](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/Dashboard.tsx#L29-L38), [L47–68](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/Dashboard.tsx#L47-L68).

Simplificação: iniciar em `Hoje`. Navegação principal com Hoje, Pedidos, Produção, Materiais, Compras e Financeiro; cadastros, integração e relatórios ficam acessíveis como apoio. Usar “pedido do cliente”, “produção do pedido” e “impressão de uma placa” na UI, mantendo OP/job nos detalhes para quem precisa. A quantidade de conceitos não desaparece do domínio: na maçã composta existem pelo menos pedido, produto/receita, placa, impressão, impressora, componente/lote e montagem. Esses sete conceitos precisam ser ensinados no contexto de uma tarefa, não apresentados como sete destinos a escolher.

## 6. P0 — Estoque por material/cor não responde onde estão as bobinas das três máquinas

O estoque guarda item, material, cor, saldo agregado, unidade e fornecedor. A Fila consulta telemetria de online, status, progresso e tempo restante; não mostra bobina carregada e saldo físico. O BambuMaterialSelection consegue exibir AMS/posição, item físico escolhido e saldo agregado durante configuração/apuração de uma execução. Isso é uma capacidade existente que deve ser reaproveitada, mas não oferece uma visão das três máquinas com saldo por bobina/localização nas telas examinadas.

Evidência: [inventory_items em types.ts, L1466–1496](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/integrations/supabase/types.ts#L1466-L1496); [Fila.tsx, L131–141](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/planejamento/Fila.tsx#L131-L141); [BambuMaterialSelection.tsx, L63–71](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/components/bambu/BambuMaterialSelection.tsx#L63-L71).

Simplificação: separar material de catálogo de bobina física. Mostrar bobina, peso disponível, posição atual (estoque, máquina, AMS, externa), reserva para a fila e data/origem da última medição. Trocar uma bobina de máquina transfere localização; não é nova compra nem consumo. Telemetria de cor/posição não deve ser promovida automaticamente a peso real. Essa visão permite responder “tenho marrom na máquina 2 e consigo transferir para a 1?” antes de comprar de novo.

## 7. P1 — Reposição é reativa ao mínimo, sem olhar o trabalho já vendido

Alertas considera saldo negativo ou abaixo do mínimo; a sugestão de custo é déficit até o mínimo multiplicado pelo custo médio. A tela não consulta demanda da fila nem pedidos de compra abertos. Os botões levam a Compras e Movimentações sem transferir um conjunto de materiais sugeridos. Assim, um estoque acima do mínimo pode parecer OK mesmo quando a produção comprometida consumirá tudo amanhã.

Evidência: [Alertas.tsx, L20–43](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/estoque/Alertas.tsx#L20-L43), [L58–65](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/estoque/Alertas.tsx#L58-L65).

Simplificação: projetar saldo por material/cor e data, somando bobinas utilizáveis e entregas previstas, descontando demanda confirmada e reserva de segurança. Mostrar “faltam 430 g para pedidos que precisam estar embalados sexta; comprar até terça pelo prazo do fornecedor”. Gerar rascunho de compra agrupado por fornecedor e múltiplos de embalagem, considerar frete e itens já em trânsito. Manter a confirmação de compra no momento de assumir a obrigação comercial.

Compras já tem uma base melhor do que a impressão de burocracia sugere: cadastro de fornecedor e forma de pagamento no contexto, importação XML, parcelas e opção de receber agora. A compra manual usa uma RPC para salvar compra, parcelas e recebimento opcional em conjunto. [Compras.tsx, L209–229](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/estoque/Compras.tsx#L209-L229). O próximo ganho é pré-preencher demanda e evitar compras repetidas, não desmontar esse caminho.

## 8. P1 — Apuração de cada impressão pede contabilidade manual demais

Ao encerrar/apurar uma execução sem lançamento anterior, o diálogo exige consumo total, minutos reais, perda, mão de obra, indiretos e acessórios/embalagem; exige material secundário se houver, além da impressora e motivo em falha. Os custos podem ser zero, mas o operador precisa digitá-los. A API faz o lançamento integrado de custos/estoque, portanto a integridade tem valor; a carga de entrada é o ponto a melhorar. Receitas com mais de dois materiais redirecionam à apuração Bambu no fluxo manual, o que limita a operação genérica pela tela.

Evidência: [ProductionTransitionDialog.tsx, L35–53](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/components/production/ProductionTransitionDialog.tsx#L35-L53), [L69–78](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/components/production/ProductionTransitionDialog.tsx#L69-L78); [Jobs.tsx, L181–187](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/producao/Jobs.tsx#L181-L187).

Simplificação: presets de custos por operação/SKU, captura automática de tempo quando confiável, leitura do fatiador com origem identificada e confirmação rápida de quantidade aprovada. Expor edição detalhada em exceção. Uma falha pode precisar de pesagem, causa e reimpressão; não usar consumo total planejado como consumo real de uma falha parcial. Permitir qualquer número de materiais também no caminho manual. Embalagem de um pedido composto deve ser lançada no estágio adequado e uma única vez; não obrigar a repetir custo da caixa em cada placa do produto.

## 9. P1 — Preço comercial e recebimento de marketplace continuam dependendo de trabalho fora da venda

A precificação soma filamento, energia, máquina, mão de obra, indiretos, reserva de falhas e extras por lote/unidade; permite preço alvo e margem. É uma boa base de custo produtivo. Não há entradas específicas de comissão do canal, tarifa fixa, subsídio/coparticipação do frete e tributação nessa função. Valores podem ser embutidos manualmente em extras/indiretos, mas isso não equivale a calcular automaticamente o resultado por canal. Conciliação é declaradamente conferência manual de lançamentos e não importa extratos automaticamente; integração ML informa que taxas e recebimentos precisam ser registrados.

Evidência: [print-pricing.ts, L3–20](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/lib/print-pricing.ts#L3-L20), [L49–87](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/lib/print-pricing.ts#L49-L87); [Conciliacao.tsx, L53–62](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/pages/financeiro/Conciliacao.tsx#L53-L62).

Simplificação: perfil de custos por canal/anúncio e resultado líquido previsto por pedido, com regras versionadas; confronto posterior com taxas e repasse efetivamente recebidos. Preservar preço bruto, desconto, frete cobrado, custo logístico, taxa, tributo, recebível e dinheiro liquidado como fatos distintos. O fluxo diário pode mostrar só “vendeu por 45, recebe 32, custo previsto 18, contribuição 14”, com acesso ao detalhamento. Regras de taxa brasileiras atuais devem ser obtidas das fontes oficiais; não fixar percentuais por lembrança.

## Desenho proposto: tela “Hoje”

Este é um desenho funcional, sem dados reais da empresa. Os números e nomes são exemplos.

```text
HOJE · sábado, 10/out                 [+ Pedido particular]  [Atualizar]
ML: atualizado há 1 min · Shopee: há 2 min · TikTok: desconectado

[3 pedidos em risco] [8 para embalar hoje] [1 máquina livre] [2 faltas futuras]

PRECISAM SAIR PRIMEIRO
Pedido/canal   Itens             Postar até       Previsão      Próxima ação
ML #123        10 maçãs          13/out 14h       12/out 10h    Imprimir corpos
WhatsApp #42   6 maçãs verdes    12/out 18h       12/out 20h    Resolver atraso
Shopee #88     2 vasos          13/out 12h       Prontos       Embalar e etiquetar
Filtros: [Todos] [Em risco] [Imprimir] [Montar] [Embalar] [Postar]

SUAS 3 MÁQUINAS                     FILAMENTO PARA O TRABALHO CONFIRMADO
P1S 1 · imprimindo · livre 13h       PLA marrom: 240 g livres / demanda 670 g
  Bobina A · PLA marrom · 320 g      Faltam 430 g até terça; entrega leva 2 dias
  Próxima: Corpos maçã · 5h          [Adicionar à compra sugerida]
P1S 2 · ociosa
  Bobina B · PLA verde · 580 g       PLA branco: 1.400 g / demanda 820 g · OK
  Sugestão: Folhas · 50 peças · 2h
  [Confirmar placa disponível]       [Ver bobinas nas máquinas e no estoque]
A1 · imprimindo · livre 16h
  Bobina C · PLA vermelho · 210 g

MONTAGEM E EMBALAGEM                 EXCEÇÕES QUE PEDEM DECISÃO
Maçã: corpos 10 · caules 40          1 SKU Shopee sem vínculo → [Vincular]
folhas 50 → montar 10 agora          1 falha parcial → [Conferir e reimprimir]
[Confirmar 10 montadas]              1 prazo inviável → [Ver alternativas]
2 pedidos com produtos completos
[Abrir bancada de embalagem]
```

O cartão de máquina recomenda o próximo trabalho compatível e informa por que ele é prioritário. Não promete iniciar remotamente a impressora: no código, `Iniciar no ERP` atualiza estado e orienta início físico no equipamento/fatiador ([ProductionTransitionDialog.tsx, L63–64](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/src/components/production/ProductionTransitionDialog.tsx#L63-L64)). Um adaptador pode comandar equipamento somente quando a conexão oferecer capacidade suportada e testada. Monitoramento ou sucesso de teste isolado não comprova despacho físico.

Para o pedido particular, o primeiro formulário deve caber em uma sequência curta: cliente/contato, produto e variante, quantidade, prazo combinado, modalidade de entrega e pagamento; preço sugerido, estoque, necessidade de produção e previsão de saída aparecem calculados. Se houver pendência, a pessoa vê uma explicação acionável antes de confirmar. Campos fiscais/comerciais completos continuam acessíveis quando necessários.

## O que preservar ao simplificar

- Orçamento, venda e produção separados no domínio: proposta não é receita e produção para estoque não é venda.
- Produto composto com rendimentos diferentes por placa, estoque de componentes aprovados, reservas, perdas e montagem. Dez placas terminadas não equivalem automaticamente a dez produtos vendáveis.
- Lançamentos transacionais, proteção de repetição, vínculos históricos, cancelamento controlado e isolamento de empresa. Reduzir cliques não significa editar saldo diretamente.
- Fonte e versão de arquivo/receita preservadas no trabalho liberado. SKU preparado pode automatizar o caminho; mudanças técnicas pedem revisão.
- Diferença entre custo estimado, referência de fatiador, medição e liquidação financeira. A UI pode sugerir valores sem falsificar precisão.

Referências da integridade existente: [gc-and-3d-operating-model.md, L19–26](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/docs/gc-and-3d-operating-model.md#L19-L26) e [component_stock_and_assembly.sql, L376–394](https://github.com/Guilherme-pedrosa/forge-flow/blob/e737da9f6ff151eadae648308d44a5d7c39d5da2/supabase/migrations/20260926070000_component_stock_and_assembly.sql#L376-L394). A documentação descreve testes anteriores; esta auditoria não os reexecutou e não os apresenta como validação da implantação atual.

## Validação de uso antes de ampliar módulos

Pedir a Gleyce para executar cinco cenários com dados isolados: venda particular de SKU pronto; venda de SKU a produzir; maçã com placas de rendimentos diferentes e sobra de caules; bobina movida entre máquinas; compra agrupada que atende duas faltas futuras. Medir tempo total, digitações, troca de páginas, dúvidas e retrabalho. O critério principal é o pedido válido aparecer no mesmo lugar e revelar a próxima ação, seu prazo e a restrição real. A arquitetura nova deve reduzir passos rotineiros; não há neste material dados suficientes para prometer uma redução percentual ou atribuir abandono exclusivamente à interface.
