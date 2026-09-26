# Referência funcional — GestãoClick

Inspeção direta da sessão autenticada em 26/09/2026. Apenas navegação e preenchimento de formulários novos; nenhum cadastro ou lançamento foi salvo na referência. Não foram copiados registros de clientes, fornecedores, produtos ou valores financeiros da conta.

## Observado na aplicação

- `/produtos/adicionar`: cadastro amplo, navegação por Dados, Detalhes, Valores, Estoque, Fotos, Fiscal, Fornecedores e Lojas. Composição e variações são opções, não condições para cadastrar um produto simples.
- Valores: custo pago + despesas acessórias + outras despesas = custo final. Confirmado no formulário com 100 + 10 + 5 = 115, sem salvar. Valor de venda pode ser informado diretamente ou calculado a partir do lucro sobre o custo.
- Estoque: quantidade atual, mínimo e máximo por loja dentro do mesmo cadastro.
- Listas: busca, colunas e ações diretas para visualizar, editar, excluir e abrir outras operações.
- `/estoque/compras/compras_produtos/adicionar`: fornecedor, emissão e situação; grade de produtos com quantidade, unidade, custo e subtotal; frete, impostos, desconto; pagamento à vista ou parcelas com intervalo em dias e primeiro vencimento; total antes de cadastrar.
- `/estoque/ajustes_estoques/adicionar`: escolha Entrada/Saída e múltiplos produtos, quantidade, unidade e custo, com observações. Quantidade de saída é informada positiva.
- `/financeiro/movimentacoes_financeiras/adicionar_pagamento`: descrição, competência, valor, fornecedor, classificação, condição de pagamento, vencimentos e resumo. Listagem oferece período e acesso aos títulos que vencem hoje.

## Implementado nesta revisão

- Cadastro de produtos amplo com abas Dados, Valores, Estoque, Fotos e Composição/produção, preservando as ferramentas existentes de impressão.
- Custo detalhado persistido, código de barras, cálculo opcional de venda por lucro sobre custo e limite máximo de estoque. Operação atômica e idempotente continua a salvar produto, fotos e saldo.
- Compra com formulário amplo, subtotal por linha, custo sugerido para unidades, nota fiscal, impostos/outras despesas e parcelas individualmente revisáveis. Conversão de rolos/embalagens permanece explícita para gramas/kg.
- Entradas/saídas/conferência com quantidade positiva, saldo resultante e múltiplos produtos em uma única transação.
- Financeiro com parcelas editáveis, resumo do lançamento, intervalo de vencimento e filtro de hoje.
- Clientes e fornecedores com formulário completo, tipo de pessoa, documentos, situação, múltiplos endereços, contatos e observações; fornecedor acessível no menu e dentro da compra, cliente dentro do orçamento.
- Orçamento em lista de documentos, busca de clientes/produtos, parcelas e conversões para venda ou OP. Emissão e aprovação comercial independem da receita de impressão.
- Documento de OP com preparação técnica separada, liberação atômica para a fila, vínculo com venda posterior e preservação dos trabalhos já criados. Ver [modelo operacional e fontes de pesquisa](gc-and-3d-operating-model.md).
- Validação: 355 testes de interface/lógica, 54 cenários PostgreSQL de ERP, 23 de orçamento/produção, 13 de variantes, 11 de apuração Bambu, 6 de receita Bambu, 16 de placas e 9 de arquivos. Fluxos em navegador verificados a 1440 e 390 pixels. Typecheck e build aprovados.

## Limites da equivalência

Não representa uma cópia completa do GestãoClick. Múltiplas lojas, grades comerciais, múltiplas tabelas de preços, emissão fiscal e rateio financeiro não foram criados nesta revisão. Excluir dados com histórico financeiro/estoque continua respeitando a integridade da operação; arquivamento e cancelamento preservam o histórico.
