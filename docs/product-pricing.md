# Custos e precificação

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

Validação: `scripts/test-product-pricing.mjs` cobre permissões, revisões, tarifas, fontes e aceites; `scripts/test-pricing-acceptance.mjs` contém um oráculo independente, inclusive produto composto, rendimento, rodadas e sobras. Os valores numéricos das fixtures são exemplos sintéticos, não tarifas da Elevare3D.
