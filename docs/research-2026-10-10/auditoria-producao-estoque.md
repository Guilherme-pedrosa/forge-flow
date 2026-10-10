# Auditoria de produção e estoque — Forge Flow

Base: `Guilherme-pedrosa/forge-flow`, commit `e737da9f6ff151eadae648308d44a5d7c39d5da2`. Análise estática de páginas, componentes, bibliotecas, função Bambu e migrações até `20260930040000_piece_technical_specs.sql`. Não consultei banco, não executei scripts de produção e não alterei código do projeto. A aplicação das migrações e a configuração de coletores externos no ambiente implantado ainda precisam ser conferidas.

## Conclusão

O núcleo já contém boa parte do ERP de uma farm: OP independente de venda, múltiplas placas, estoque por peça/SKU, planejamento que aproveita saldo e fila, reservas de componentes, apuração Bambu, qualidade parcial, perdas e montagem. O problema principal é consolidar os caminhos de operação e automatizar o caso rotineiro. Existem também defeitos nas conexões entre funcionalidades recentes: execução Bambu não planejada versus saídas físicas de subitens, troca de cor versus SKU de destino e reposição dentro da OP versus rastreabilidade.

A documentação anterior não descreve integralmente o modelo atual. `docs/component-stock-and-assembly.md` ainda diz que peças diferentes na mesma placa precisam de componentes/placas separados; as migrações de 30/09 introduziram peças independentes na mesma placa. Não se deve redesenhar o produto partindo dessa limitação antiga.

## Modelo efetivamente encontrado

| Conceito | Representação atual | Implicação operacional |
|---|---|---|
| Produto vendido | `products`, composição e snapshot comercial | O produto final pode exigir vários subitens e placas. |
| OP | `production_orders` e `production_order_items` | Preparação e liberação técnica ficam separadas da venda; há produção para estoque. |
| Tentativa de impressão | `jobs` | Uma tentativa pode produzir várias peças físicas; reimpressão preserva a tentativa anterior. |
| Placa | `product_print_plates` | Configuração de arquivo/material/tempo/rendimento, não saldo físico. |
| Peça física | Produto filho + `product_subitems` + `inventory_items` | SKU e saldo próprios; várias peças podem sair juntas da mesma placa. |
| Saídas da tentativa | `production_snapshot.physical_outputs`, `job_subitem_outputs` | A qualidade aprova separadamente a quantidade boa de cada peça. |
| Reserva de peças | `production_subitem_demands` | Prioridade de atendimento por ordem de liberação; a montagem consome a demanda. |
| Montagem | `product_assemblies`, `assembly_subitem_allocations` | Consome os subitens uma vez; para estoque recebe o produto final, dentro da OP o destina à ordem. |
| Filamento | Item de estoque por material/cor, em g ou kg | Controle agregado por item; não encontrei entidade física de bobina nem localização/slot como estoque. |
| Bambu | Histórico, telemetria cloud, perfil de apuração, consumo por filamento | Acompanhamento e contabilização; preparação/download não comandam a impressora. |

Evidência da separação placa/peça: [migração de estoque individual](/workspace/forge-flow/supabase/migrations/20260930030000_individual_subitem_inventory.sql:1). Evidência do agrupamento de saídas e planejamento da maior necessidade da placa: [planejador de subitens](/workspace/forge-flow/supabase/migrations/20260930031000_subitem_production_outputs.sql:2).

## Nove achados prioritários

### 1. P1 — Execução Bambu sem job previamente vinculado pode consumir filamento e deixar as peças sem caminho de entrada no estoque

**Tipo:** defeito de integração confirmado por leitura; precisa de reprodução em banco de teste.

**Condição:** produto com `component_inventory_mode` e execução configurada pelo catálogo, sem alocação a um job criado pelo planejamento de subitens. A UI apresenta esse vínculo como opcional e também permite automatizar as próximas execuções do perfil.

O contexto Bambu usa o BOM do catálogo quando não recebe snapshots de jobs. Esse BOM possui `individual_stock` e `physical_components`, mas `physical_outputs` só é criado por `subitem_plate_plan`. O caminho Bambu cria uma tentativa com `rec.material_snapshot`, sem chamar esse planejador. A apuração pode lançar o consumo e levar o job à qualidade, mas a tela de subitens só oferece conferência para jobs com `physical_outputs`. A confirmação legada rejeita todos os jobs `individual_stock`; a entrada nova espera as saídas congeladas.

Evidências: [contexto sem jobs](/workspace/forge-flow/supabase/migrations/20260913041000_material_variants.sql:194), [criação física Bambu](/workspace/forge-flow/supabase/migrations/20260913030000_bambu_production.sql:309), [patch que insere o snapshot](/workspace/forge-flow/supabase/migrations/20260913041000_material_variants.sql:350), [única criação de saídas físicas](/workspace/forge-flow/supabase/migrations/20260930031000_subitem_production_outputs.sql:22), [filtro da conferência](/workspace/forge-flow/src/components/production/PhysicalSubitemWorkspace.tsx:66), [bloqueio da aprovação legada](/workspace/forge-flow/supabase/migrations/20260930031000_subitem_production_outputs.sql:147). A última migração técnica só enriquece `physical_components`; não cria `physical_outputs`.

**Correção recomendada:** uma única função para congelar a receita de execução, a placa e suas saídas físicas, usada tanto no planejamento quanto na importação Bambu. Quantidades não confirmadas devem pedir conferência simples. Não receber peças silenciosamente e não obrigar o operador a refazer a entrada como ajuste manual. Perfis configurados a partir de jobs que já têm saídas físicas podem funcionar; o defeito é especificamente o caminho sem esse snapshot.

### 2. P1 — Trocar a cor na execução pode dar entrada no SKU físico da cor anterior

**Tipo:** inconsistência entre regra de planejamento e regra de execução.

O planejamento de produto com estoque individual rejeita overrides de material/cor e exige outro subitem/SKU para outra cor. Porém, na configuração Bambu de jobs sem `order_item_id` — incluindo produção para estoque — o contexto permite aplicar variantes e atualizar `material_selection_snapshot`. A qualidade continua recebendo no `stock_item_id` do `production_snapshot` original.

Exemplo de risco: a placa estava planejada para um subitem branco; o operador seleciona um filamento marrom permitido como variante na execução para estoque. O consumo pode baixar marrom, mas a aprovação recebe o subitem branco original. Isso afeta estoque, promessa ao cliente e compras futuras.

Evidências: [restrição no planejamento](/workspace/forge-flow/supabase/migrations/20260930031000_subitem_production_outputs.sql:39), [política por vínculo comercial](/workspace/forge-flow/supabase/migrations/20260913041000_material_variants.sql:190), [aplicação de variantes](/workspace/forge-flow/supabase/migrations/20260913041000_material_variants.sql:203), [snapshot de execução separado](/workspace/forge-flow/supabase/migrations/20260913041000_material_variants.sql:295), [destino físico original na qualidade](/workspace/forge-flow/supabase/migrations/20260930031000_subitem_production_outputs.sql:178).

**Correção recomendada:** validar a identidade material/cor do SKU de saída no servidor; trocar o SKU de destino explicitamente antes de iniciar, preservando revisão e rastreabilidade. A promessa comercial deve continuar congelada. Pode ser necessário um modelo explícito de variantes físicas para evitar proliferar cadastros manuais.

### 3. P1 operacional — Filamento tem saldo e custo, mas ainda falta a bobina física e a reserva do material para execução

**Tipo:** lacuna de desenho para farm.

O cadastro e as movimentações já controlam material/cor, marca, diâmetro, g/kg, custo médio e perda. A composição admite muitos materiais. Isso é útil e deve ser preservado. Entretanto, o arquivo da ordem informa expressamente que o saldo de filamento ainda não está reservado. Não encontrei nas migrações entidade de bobina, tara, peso remanescente por bobina, posição física, secador/AMS, nem reserva de matéria-prima por impressão. `ams_id` e `slot_id` são observações do histórico em JSON; não equivalem a estoque por bobina.

Com 1.000 g no saldo agregado, duas OPs podem parecer viáveis usando o mesmo material, e uma impressão de 300 g ainda pode falhar se a bobina instalada tem só 120 g. A apuração é onde o movimento efetivamente baixa material e impede saldo negativo; esse controle tardio não assegura disponibilidade antes de imprimir.

Evidências: [campos do item agregado](/workspace/forge-flow/src/integrations/supabase/types.ts:1466), [saldo sem reserva](/workspace/forge-flow/src/components/production/ProductionFileDialog.tsx:68), [observação de AMS/slot](/workspace/forge-flow/supabase/migrations/20260913041000_material_variants.sql:174), [consumo na apuração](/workspace/forge-flow/supabase/migrations/20260913011000_erp_production.sql:84). As reservas encontradas são de subitens/peças, não bobinas.

**Evolução recomendada:** acrescentar bobina com QR, SKU de filamento, tara, peso disponível, localização e instalação na impressora/AMS; reservar consumo estimado com margem e conciliar consumo informado versus pesagem. A origem da medição e sua confiança precisam permanecer explícitas. Sugestões de compra devem partir de demanda líquida, saldo reservado, recebimentos previstos e prazo do fornecedor.

### 4. P1 para operação multimarcas / P2 para adoção — O fechamento manual continua exigindo contabilidade por tentativa e não fecha receitas com três ou mais materiais

**Tipo:** limitação funcional e gargalo de usabilidade.

No caso manual rotineiro, avançar da impressão para qualidade exige preencher consumo, tempo, mão de obra, custos indiretos e acessórios/embalagem, além da perda; os custos começam vazios e zero precisa ser digitado. Para duas matérias, ainda pede o consumo secundário. Para três ou mais, Jobs e Fila interrompem a ação e mandam para apuração Bambu. A guarda do banco também limita a conclusão manual a dois materiais, apesar de a composição aceitar até 64 materiais e a ficha técnica até 16.

Isso cria trabalho administrativo em todas as placas e um bloqueio para máquina sem integração Bambu ou histórico indisponível. O ERP tem composição/estimativas e pode evitar recolher novamente tudo que já foi informado; deve distinguir custo estimado confirmado de custo efetivamente medido.

Evidências: [campos obrigatórios](/workspace/forge-flow/src/components/production/ProductionTransitionDialog.tsx:40), [inputs por tentativa](/workspace/forge-flow/src/components/production/ProductionTransitionDialog.tsx:80), [bloqueio na página Jobs](/workspace/forge-flow/src/pages/producao/Jobs.tsx:181), [bloqueio na Fila](/workspace/forge-flow/src/pages/planejamento/Fila.tsx:205), [guarda no banco](/workspace/forge-flow/supabase/migrations/20260913037000_production_files.sql:109).

**Evolução recomendada:** fechamento rápido com peças boas, rejeitadas e motivo quando houver exceção; consumo por lista de todos os materiais; tempo e custos sugeridos pela execução/perfil; ajustes avançados opcionais. Manter a operação transacional e permitir revisão posterior auditada. Não transformar estimativa em pesagem por conveniência.

### 5. P2 — Rateio por quantidade distorce custo de peças diferentes na mesma placa e absorve todas as perdas nas peças boas

**Tipo:** política de custeio implementada, inadequada para certas placas mistas.

O custo total da placa é dividido pelo total de unidades físicas boas. Cada corpo grande, folha pequena ou haste recebe o mesmo custo unitário, e rejeições diminuem o divisor. O total da placa é conservado, mas a distribuição entre estoque dos subitens pode ficar incorreta. Quando sobras e peças compartilhadas entram em outros produtos, a margem desses produtos fica enviesada.

Exemplo: uma placa de R$ 20 produz dez corpos de 18 g e dez folhas de 2 g. O código atribui R$ 1 a cada peça. Só pela matéria-prima proporcional ao peso, a distribuição equivalente seria R$ 1,80 por corpo e R$ 0,20 por folha; custos de máquina e preparação podem exigir outra base. Uma placa com proporções diferentes de saída ou montagem parcial torna essa diferença relevante. A ficha técnica nova contém g/tempo por peça, mas está deliberadamente separada da valorização e não altera esse rateio.

Evidências: [rateio atual](/workspace/forge-flow/supabase/migrations/20260930031000_subitem_production_outputs.sql:175), [ficha técnica não altera valorização](/workspace/forge-flow/supabase/migrations/20260930040000_piece_technical_specs.sql:1), [montagem usa custo médio dos componentes](/workspace/forge-flow/supabase/migrations/20260930030000_individual_subitem_inventory.sql:253).

**Evolução recomendada:** regra de rateio confirmada por perfil: gramas por material para matéria-prima; tempo/ocupação ou proporção aprovada para máquina; preparação separada quando aplicável. Separar perdas normais e anormais na visão gerencial, com política contábil definida. Continuar conservando o custo da tentativa e nunca baixar filamento novamente na montagem.

### 6. P2 — Reposição criada dentro da OP perde a ligação com a própria OP e seu prazo

**Tipo:** defeito de rastreabilidade e visibilidade.

O botão de produzir subitem dentro da OP envia `p_item_id`. A função usa o snapshot preservado da OP, mas seu `INSERT jobs` não grava `production_order_id`, `production_order_item_id`, `order_id`, `order_item_id` nem `due_date`. A tabela de impressões da OP e o link `Jobs?op=` filtram por `production_order_id`. Resultado: a reposição participa do saldo compartilhado, mas some do acompanhamento da ordem que a originou e não carrega seu compromisso de entrega.

Evidências: [chamada dentro da OP](/workspace/forge-flow/src/components/production/PhysicalSubitemWorkspace.tsx:144), [snapshot da OP sem vínculos na criação](/workspace/forge-flow/supabase/migrations/20260930031000_subitem_production_outputs.sql:105), [lista de jobs da OP](/workspace/forge-flow/src/pages/producao/Ordens.tsx:38), [filtro de acompanhamento](/workspace/forge-flow/src/pages/producao/Jobs.tsx:198). O caminho inicial de liberação grava corretamente esses campos: [liberação](/workspace/forge-flow/supabase/migrations/20260926050000_commercial_production_separation.sql:176).

**Correção recomendada:** preservar vínculo de origem, prazo e motivo, sem alocar a receita comercial novamente em cada reposição. Se o lote puder atender várias OPs, registrar alocações/destinos separados do vínculo de origem e mostrá-los no acompanhamento.

### 7. P2 — A fila exibe prioridade e máquinas, mas não responde quando o pedido ficará pronto

**Tipo:** capacidade e programação ainda manuais.

A Fila ordena por prioridade e data de criação, agrupa jobs por impressora e mostra tempo de cada impressão. Há prazo na OP/jobs e reservas de peças com ordem de liberação, mas não há cálculo de término previsto por máquina, risco de prazo, janela de troca de placa, acabamento/montagem ou agrupamento por material/cor. Para produtos com placas, o formulário ainda oculta a prioridade e a impressora; usa o planejamento das placas e seus valores padrão. A reserva FIFO também não é reordenada quando uma venda mais urgente aparece.

Evidências: [ordenação da fila](/workspace/forge-flow/src/pages/planejamento/Fila.tsx:99), [prioridade só para produto sem placas](/workspace/forge-flow/src/pages/planejamento/Fila.tsx:273), [informações por cartão](/workspace/forge-flow/src/pages/planejamento/Fila.tsx:398), [reserva por sequência](/workspace/forge-flow/supabase/migrations/20260930030000_individual_subitem_inventory.sql:164).

**Evolução recomendada:** programação assistida com sugestão de máquina compatível e próxima placa, término previsto do conjunto completo e alerta de pedido em risco. Usar prazo real de expedição e incluir montagem/embalagem. Agrupar material/cor quando não ameaçar o compromisso. Permitir exceção e repriorização auditadas; manter o bloqueio que impede duas execuções ERP simultâneas na mesma máquina.

### 8. P2 — Jobs e fila principal ainda podem omitir registros ao crescer

**Tipo:** risco de truncamento condicionado ao limite da API.

O projeto tem um helper explicitamente criado porque Supabase limita respostas a 1.000 linhas; BambuReview e várias páginas novas paginam. Entretanto Jobs carrega todas as tentativas sem `range` e filtra OP/situação no cliente; a Fila também busca todos os jobs ativos sem paginação. Além da omissão silenciosa acima do limite configurado, Jobs busca o histórico inteiro para cada filtro. Numa farm, 1.000 tentativas não representam um histórico grande.

Evidências: [helper e limite documentado](/workspace/forge-flow/src/lib/production-read.ts:1), [Jobs sem paginação](/workspace/forge-flow/src/pages/producao/Jobs.tsx:109), [fila sem paginação](/workspace/forge-flow/src/pages/planejamento/Fila.tsx:99), [BambuReview já usa paginação](/workspace/forge-flow/src/lib/bambu-production-api.ts:54).

**Correção recomendada:** filtros de OP/status/período no servidor, paginação estável e contagens próprias. Para programação operacional, garantir a consulta completa dos jobs ativos ou mostrar claramente o recorte. Conferir o limite efetivo de retorno da implantação.

### 9. P2 — Atualizar a tela de status a cada 15 segundos não garante telemetria recente na origem

**Tipo:** lacuna de ligação observada; coletor externo pode existir fora deste repositório.

A Fila consulta `bambu_devices` a cada 15 s; Impressoras consulta o cadastro e escuta alterações no banco. O endpoint `action: telemetry` existe e atualiza progresso/status/última observação. Contudo, não encontrei chamada a essa ação no frontend materializado. A sincronização periódica SQL consulta o histórico `/my/tasks` e atualiza `bambu_tasks`, sem renovar `bambu_devices` ou o status das impressoras. O conteúdo mostrado pode depender de um coletor externo ou do último sync de descoberta. É preciso conferir o ambiente implantado antes de afirmar que a farm tem acompanhamento contínuo.

Adicionalmente, o endpoint de telemetria grava o status cloud diretamente em `printers.status`, inclusive sobre um estado local de manutenção. A biblioteca `resolvePrinterStatus` tenta preservar manutenção, mas não consegue recuperar o estado depois de ele ser sobrescrito no banco.

Evidências: [polling dos dispositivos](/workspace/forge-flow/src/pages/planejamento/Fila.tsx:131), [polling/realtime do cadastro](/workspace/forge-flow/src/pages/producao/Impressoras.tsx:71), [endpoint de telemetria](/workspace/forge-flow/supabase/functions/bambu-cloud-sync/index.ts:305), [escrita direta do status](/workspace/forge-flow/supabase/functions/bambu-cloud-sync/index.ts:507), [sync periódico só de tarefas](/workspace/forge-flow/supabase/migrations/20260913031000_bambu_direct_sync.sql:151), [preservação desejada da manutenção](/workspace/forge-flow/src/lib/production.ts:87).

**Evolução recomendada:** um coletor explícito, saúde de sincronização e timestamp visíveis em cada máquina; separar estado de telemetria de indisponibilidade operacional/manutenção. Comando físico deve ser outra capacidade, com compatibilidade, confirmação local de retirada da peça/mesa livre e idempotência próprias. O código atual é transparente sobre envio pelo Studio/Connect: [fluxo de arquivo](/workspace/forge-flow/src/components/production/ProductionFileDialog.tsx:88).

## O que preservar

- Separação comercial e técnica: aprovação da venda não precisa significar que o cadastro técnico está completo; a OP permite preparar depois. Produção para estoque existe e a OP pode ser atendida por peças já disponíveis sem criar impressões artificiais.
- Modelo recente de peça física com SKU/estoque próprios, separado da placa. O planejador calcula o máximo de impressões exigido entre os subitens da mesma placa e aproveita saldo/fila, deixando sobras disponíveis.
- Snapshots de receita/arquivo/material por tentativa e por OP; não substituí-los pelo cadastro atual a cada leitura. Compatibilidade de arquivo/máquina já recebe alguma validação.
- Escritas centrais por RPC, chaves de repetição, bloqueios e movimentações que impedem duplicar consumo ou levar estoque abaixo de zero. A montagem consome componentes, não matéria-prima pela segunda vez.
- Qualidade por peça, rejeição parcial e perdas posteriores à impressão. A peça só vira saldo disponível depois da conferência; imprimir tudo não equivale a montar o produto final.
- Cadastro de material/cor exato e g/kg, opções explícitas de variante, preenchimento pendente quando a informação é desconhecida. Importação não deve inventar rendimento ou equivalência de filamento.
- Origem de consumo já diferenciada no ledger Bambu: `slicer_completed` e `measured`. Peso cloud vem de `task.weight`; não representa automaticamente leitura de balança ou peso remanescente na bobina. Falhas e objetos ignorados exigem consumo informado, e a UI avisa isso. [Fonte cloud](/workspace/forge-flow/supabase/functions/bambu-cloud-sync/index.ts:1934), [proteção de consumo parcial](/workspace/forge-flow/supabase/migrations/20260913030000_bambu_production.sql:285), [UI de origem](/workspace/forge-flow/src/components/bambu/BambuProductionPanel.tsx:193).

## Critérios de validação recomendados para a próxima versão

1. Importar/apurar uma impressão não planejada de produto com dois subitens na mesma placa; receber separadamente as peças boas sem ajuste manual paralelo.
2. Configurar um perfil Bambu sem job prévio, automatizar a próxima tentativa e confirmar suas saídas físicas; repetir o lançamento sem duplicar saldo/consumo.
3. Trocar a cor de produção para estoque: bloquear SKU incompatível ou receber no SKU escolhido explicitamente; nunca misturar variantes no mesmo saldo.
4. Criar reposição dentro de OP e enxergá-la no acompanhamento da OP, com prazo e motivo, sem duplicar receita comercial.
5. Concluir impressão em máquina sem Bambu com três ou quatro materiais; consumo completo e qualidade corretos em uma operação.
6. Dividir uma placa mista entre peças grandes/pequenas, com sobra e rejeição parcial; custo total conservado e regra de rateio visível.
7. Reservar a mesma matéria-prima para duas OPs concorrentes; informar a demanda líquida e impedir promessa de uso da mesma bobina em duas máquinas.
8. Consultar mais de 1.000 jobs e acompanhar OP antiga; nenhum registro deve sumir por truncamento da API.
9. Marcar impressora em manutenção e receber telemetria de máquina online/idle; manutenção permanece como bloqueio operacional.

Estes cenários são proposta de validação em ambiente de teste, não testes executados contra a operação real.
