# Referência funcional do integrador Mercado Livre

Resumo das decisões para o Forge Flow, a partir da análise somente leitura do integrador indicado pelo usuário em 10/10/2026. A avaliação detalhada do repositório privado permanece no caderno local entregue ao proprietário; este documento registra as decisões aplicáveis ao ERP.

O padrão útil é orientar a interface pelo trabalho do dia: pedido, prazo de despacho, pendência e próxima ação. Eventos recebidos, integração concluída, baixa de estoque, etiqueta, despacho e repasse são fatos diferentes. Reserva comercial não deve depender de terminar uma etapa fiscal.

Um integrador comercial não substitui o modelo fabril. No Forge, o pedido gera necessidades de produtos e peças; uma peça pode exigir várias placas; a execução de uma placa tem rendimento e materiais congelados; somente a quantidade aprovada atende a demanda. Montagem, embalagem e transporte seguem suas próprias confirmações.

As fronteiras adotadas nesta atualização são:

- Adaptadores de canal traduzem identidade, estado, variantes, prazo e valores externos para a caixa canônica de pedidos.
- O núcleo fabril calcula saldo pronto e falta, conserva a composição aprovada e organiza a produção sem repetir a quantidade comercial.
- Estoque registra movimentos físicos uma vez e mantém reservas separadas de consumo.
- Financeiro mantém venda bruta, despesas do canal, principal retido e líquido bancário distintos. Tarifas não viram desconto fiscal da venda.
- Uma operação repetida recupera o resultado confirmado; dados antigos não sobrescrevem uma revisão mais recente.

O [guia de operação](../operacao-3d-2026-10-10.md) descreve a implementação, e a [matriz de cobertura](../coverage-2026-10-10.md) mostra o que ainda falta. Nenhuma avaliação estática comprova autorização ativa, desempenho real ou uso pela operadora.
