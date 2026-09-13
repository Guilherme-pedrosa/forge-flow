# Compra, cor, preço e produção

O produto conserva sua composição padrão. Orçamentos, pedidos e impressões podem escolher outra cor do mesmo material, sem duplicar o produto ou reescrever a composição usada anteriormente.

## Jornada de uso

1. Em **Estoque**, identifique cada material por tipo (PLA, PETG etc.), cor e unidade de controle. Estoque de filamento usa g ou kg; bobina é a embalagem comprada.
2. Em **Compras**, selecione esse material e informe a quantidade comercial e o preço. O conversor permite, por exemplo, comprar duas bobinas e receber 2.000 g. XML aproveita a unidade comercial quando ela é g/kg. O recebimento atualiza o saldo e o custo médio ponderado do item, considerando o total rateado da compra.
3. No **Produto**, vincule o arquivo/perfil, prepare os materiais de cada placa e informe quantas unidades comerciais ela atende. Essa relação não pode ser deduzida apenas da quantidade de objetos do arquivo.
4. No **Orçamento** ou **Pedido**, escolha o produto, a quantidade e a cor de cada parte. O custo considera o material escolhido e todas as impressões inteiras necessárias. A margem desejada oferece um preço para aplicar ao item; custos ausentes permanecem pendentes.
5. Ao aprovar, a seleção fica preservada. A conversão de orçamento em venda e a criação da fila conservam cores, materiais, placas e previsão de custo aprovados. A proposta impressa mostra a composição escolhida sem expor os custos internos.
6. Na **Bambu**, a revisão distingue o material do arquivo original daquele informado na execução/AMS. Uma correspondência única e exata pode ser sugerida; um vínculo anteriormente confirmado pode ser reutilizado para a mesma origem. Correspondências ambíguas exigem escolha explícita.
7. Uma impressão sem venda pode usar outra cor e registrar essa escolha só na execução. Uma ordem comercial exige a cor aprovada. Na apuração, o custo efetivo usa o consumo registrado e o custo médio do item físico naquele momento.
8. Impressões interrompidas exigem consumo medido. O lançamento registra perda e baixa apenas o material informado, sem usar automaticamente todo o peso previsto da placa.

## Garantias e limites

- Variações aceitam apenas itens ativos, identificados, da mesma empresa e do mesmo material; trocar PLA por PETG requer uma composição/perfil adequado.
- Cada escolha pertence ao produto/componente, placa e linha de material. Base e tampa podem ter cores distintas; kits preservam esse vínculo sem duplicar o controle de um mesmo componente.
- Repetir uma apuração não duplica estoque ou custo. Uma cor diferente no AMS interrompe a apuração automática até revisão. Vendas com cores incompatíveis não são alocadas silenciosamente na mesma tentativa.
- Valores mostrados antes de produzir são previsões. Peso e duração planejados do fatiador não são pesagem nem duração real. O consumo do fatiador só é aceito como referência após conclusão integral e mediante configuração explícita; falhas ou objetos ignorados exigem medição.
- O resultado sugerido no orçamento é anterior a frete, descontos e taxas da venda. Não é uma promessa de lucro líquido.
- A fila oferece preparação do arquivo e conferência da impressora. O disparo físico direto pelo ERP ainda não está disponível; o operador inicia a impressão pelo Bambu Studio/Handy e a sincronização a acompanha.

## Entrega técnica

- Migração `20260913041000_material_variants.sql`: variantes por item comercial e execução, preservação das seleções aprovadas, contexto de materiais Bambu e proteção na apuração.
- RPCs de leitura `product_material_variant_preview` e `bambu_material_selection_preview`; operações comerciais e de apuração continuam atômicas no servidor.
- Aplicação direta no banco do projeto Forge & Flow, sem mensagem ao agente Lovable. Texto aplicado: MD5 `e8eed8ddd21c33dcdc669ca33cb50a87`.
- Validação SQL: 13 cenários de variantes e 142 regressões de ERP, Bambu, placas, qualidade, receitas, orçamentos, arquivos e importação.
- Validação final de frontend: 349 testes em 40 arquivos; typecheck e build aprovados. Pedidos em cartões no celular e tabela no desktop; Bambu com título, fechar e ações fixos durante a rolagem.
- Antes da aplicação: 1 movimento de estoque, 8.000 g de saldo agregado, 10 pedidos e nenhum recebível. Nenhuma impressão física ou transação comercial foi criada como teste em produção.
- Validação visual com dados fictícios em navegador: conversão de duas bobinas de 1 kg para 2.000 g em 320 px; troca de cor e precificação em 390 px; composição no orçamento em 1440 px; distinção original/execução e custo de material na Bambu em 390 px.

## Produto real reparado

`ROLETA PREMIOS` conserva suas fotos e agora possui as três placas da variante A1 vinculada: 57 g, 65 g e 17 g, total 139 g e 4 h 18 min 46 s planejados. O usuário confirmou que o conjunto das três placas monta uma roleta; esse rendimento foi registrado em cada placa, preservando as demais informações. O histórico identifica roxo nas placas 1/2 e branco na placa 3. Ainda é necessário identificar os itens físicos dessas cores no estoque: o cadastro atual não contém correspondência exata suficiente para escolher com segurança.

Detalhes da importação e da correção operacional estão em [operational-plates-2026-09-13.md](operational-plates-2026-09-13.md).
