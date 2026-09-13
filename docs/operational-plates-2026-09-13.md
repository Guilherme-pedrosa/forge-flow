# Importação operacional de placas

A fonte vinculada da roleta salvava somente os identificadores Bambu. O detalhamento importado era uma referência JSON e não criava registros em `product_print_plates`; por isso o usuário continuava vendo a lista vazia.

O vínculo agora busca a configuração técnica exata da impressão e grava todas as placas disponíveis em uma transação: índice, peso, tempo, filamentos, material/cor de origem e observações do histórico. Perfis públicos e variantes técnicas permanecem distintos. Se um link não indicar uma configuração única, o usuário escolhe perfil e impressora. Uma tarefa privada permite recuperar a placa observada, sem inventar outras placas. Repetir a operação preserva as receitas manuais e evita duplicação.

A composição recebe os gramas conhecidos. Materiais de estoque só são selecionados automaticamente quando tipo e amostra de cor identificam um único item. Rendimento comercial desconhecido permanece pendente e pode ser confirmado junto com a composição, em uma única gravação. O resumo exibe os totais físicos antes dessa confirmação; custos por unidade e novas produções exigem uma composição completa. Pedidos aprovados e ordens existentes preservam seus snapshots.

## Validação

- Typecheck real e build passaram; 308 testes de interface/unidade passaram antes da ampliação de cenários de cor.
- Migration 040: 13 cenários PostgreSQL, incluindo idempotência, vínculo atômico, rendimento+receita, correspondências ambíguas, preservação de composição manual e vendas já aprovadas.
- Regressões SQL: 15 MakerWorld, 36 ERP, 17 orçamentos, 16 placas e 11 apurações Bambu passaram.
- Revisão visual local com o modelo público real: A1, três placas de 57 g/6370 s, 65 g/5796 s e 17 g/3360 s. Material original PLA cinza; histórico observou roxo nas placas 1/2 e branco na 3. Os dados têm origens distintas e não substituem pesagem real.
- Migration aplicada diretamente, sem mensagens ao agente Lovable: versão 20260913040000, MD5 `f21241d6a11ad62c478367c05278fd6f`.
- Fonte existente do produto ROLETA PREMIOS foi hidratada com três placas. Nenhuma movimentação de estoque, venda, recebível ou impressão foi criada por essa correção.

## Limites explícitos

O arquivo não informa quantas unidades comerciais cada placa atende. A Bambu fornece previsões de consumo do fatiamento; falhas e objetos ignorados exigem medição para baixar o consumo efetivo. O material específico deve existir no estoque e ter custo identificado. Alterações por cor na venda e na execução têm implementação separada, com preservação da composição base do produto.
