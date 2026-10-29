# Custos e precificação

## Uso diário

**Comercial → Precificação 3D** abre direto na simulação livre. Informe a quantidade de produtos completos, o peso total de filamento, o custo por kg e o tempo total das placas. O nome é opcional para calcular. Campos decimais desse caminho aceitam vírgula.

O resultado fica logo depois dos dados do fatiador em telas estreitas. Energia, uso da máquina e trabalho ficam em **Custos da impressão**; embalagem e taxas de venda têm grupos separados. A simulação preenchida é conservada ao alternar para Produto cadastrado e voltar, durante a permanência nessa tela. Trocar empresa ou usuário limpa esse rascunho.

Quando houver tarifas da empresa, elas são carregadas. Na ausência de uma margem configurada, a simulação começa com uma meta editável de 30%; isso não grava uma política da empresa. Tarifas desconhecidas continuam em branco. O subtotal de filamento conhecido é apresentado como parcial até completar os custos usados; não vira custo completo nem preço final por preencher valores com zero silenciosamente. O link de parâmetros abre outra aba para preservar a simulação.

Um link com `?produto=` continua abrindo o produto cadastrado. Quantidade, preço atual e resultado vêm primeiro; custos, composição/placas e condições de venda ficam nos detalhes. **Usar preço cadastrado no orçamento** reaproveita um preço positivo já salvo mesmo quando o novo custo estiver pendente. Essa ação preenche um orçamento para revisão; não aplica um novo custo ou altera o preço do produto. Calcular e aplicar um novo preço mantém as validações de custo completo e revisão atual.

## Formação do custo

As tarifas ficam em **Configurações → Custos e precificação**. Valores em branco são desconhecidos; zero precisa ser informado explicitamente. A hora da máquina cobre uso/desgaste e não inclui energia nem trabalho manual. Cada impressora pode ter uma tarifa específica.

Em **Comercial → Precificação 3D**, selecionar um produto carrega sua composição, placas, filamentos e tempos. O cálculo mostra material, energia, máquina, preparação/retirada, acabamento das peças, montagem final, demais insumos e despesas indiretas. Insumos cadastrados usam sua unidade e custo médio, sem movimentar estoque. A simulação livre continua disponível.

- Material: gramas × custo por kg ÷ 1.000.
- Máquina: horas de impressão × tarifa por hora.
- Energia: horas × potência em W ÷ 1.000 × R$/kWh.
- Trabalho: minutos ativos ÷ 60 × tarifa de manipulação. Preparação por placa, acabamento por peça e montagem por produto são etapas distintas.
- Despesas indiretas: percentual sobre os custos diretos de produção; insumos finais ficam fora dessa base.
- Margem sobre venda: custo unitário ÷ (1 − margem/100), arredondado para cima ao centavo.

**Padrão por unidade** usa o rendimento físico confirmado da placa para alocar seu custo. **Lote exclusivo** cobra as rodadas completas necessárias. O planejamento mostra as unidades excedentes, sem dar entrada automática dessas sobras no estoque. Placas compartilhadas por vários componentes são calculadas uma vez; os totais das fichas não são somados de novo.

Uma referência Bambu elegível fornece consumos e tempos, e as tarifas atuais recompõem o preço. Custos históricos, taxas antigas da ficha e o campo legado agregado de custo não material não são cobrados novamente. A tarifa atual de manipulação tem prioridade sobre tarifas antigas, mantendo o tempo de acabamento da ficha quando não houver ajuste.

**Salvar plano** preserva tempos, impressoras e insumos para novas simulações. **Aplicar custo e preço** exige uma prévia completa e atual, registra um aceite imutável e atualiza os valores comerciais. Não altera saldos, apurações anteriores ou orçamentos já emitidos. Tarifas globais explicitamente configuradas passam a valer nos próximos cálculos operacionais; salvar dados da empresa preserva esses parâmetros.

Na venda por canal, **Unidades por pedido / pacote** começa em 1 e é separado da quantidade produzida. Produzir um lote de 100 e vender uma unidade por pedido não divide a tarifa fixa e o frete desse pedido por 100. Os gastos são os informados pelo operador; escolher Mercado Livre ou Shopee não presume uma tabela de tarifas oficial.

Validação: `scripts/test-product-pricing.mjs` cobre permissões, revisões, tarifas, fontes e aceites; `scripts/test-pricing-acceptance.mjs` contém um oráculo independente, inclusive produto composto, rendimento, rodadas e sobras. Os valores numéricos das fixtures são exemplos sintéticos, não tarifas da Elevare3D.

Os testes de interface reproduzem abertura no caminho errado, perda da simulação ao alternar, entrada com vírgula e diferença entre lote e pacote. São verificações técnicas específicas. O aceite de facilidade de uso continua dependendo de observar a operadora precificando seus próprios produtos, sem orientação passo a passo; não se presume esse aceite pela quantidade de testes aprovados.
