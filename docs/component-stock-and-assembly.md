# Componentes, lotes e montagem

O produto comercial continua sendo a maçã completa. As placas representam os conjuntos de componentes necessários para uma unidade vendida: corpo (incluindo as duas metades, quando aplicável), caule e folha. A capacidade por impressão é quantos desses conjuntos saem de uma placa. Uma placa com dez pares de metades atende dez maçãs. Moldes e ferramentas reutilizáveis não devem ser incluídos como componentes consumidos de cada produto.

## Operação

1. Cadastros → Produtos → Composição / produção: adicionar componentes ou usar as placas já importadas, confirmar os respectivos rendimentos e materiais e ativar o controle de montagem. O cadastro comercial, custo manual e estoque do produto continuam independentes dessa preparação.
2. Produção 3D → Componentes e montagem: selecionar o produto e informar a meta. A tabela separa saldo físico, disponível, reservado, fila e novas impressões necessárias.
3. Produzir lote cria impressões apenas do componente escolhido. O arredondamento para placas completas e a sobra prevista aparecem antes da confirmação. Pode ser usado para reposição sem venda ou OP.
4. A apuração Bambu consome o filamento e apura os custos da tentativa. A aprovação de qualidade recebe os conjuntos bons uma única vez. Rejeições parciais preservam o custo total da tentativa e não baixam filamento de novo.
5. Registrar montagem / acabamento consome um conjunto de cada componente. Na produção para estoque, dá entrada no produto pronto pelo custo dos componentes mais o acabamento informado. Dentro da OP, destina o produto montado àquela ordem, sem liberá-lo para outra venda.
6. Perdas após a impressão, inclusive na termoformagem, baixam os componentes com motivo e custo rastreáveis. A necessidade de reposição é recalculada.

## Ordens de produção

A liberação considera saldo e lotes já na fila, descontando as necessidades de OPs liberadas anteriormente. As demandas são registradas sob o mesmo bloqueio transacional do planejamento. Sobras de um lote podem atender outras OPs. Componentes ainda em impressão ou conferência não podem ser montados. Uma falha ou rejeição reduz a cobertura prevista; a tela indica a nova falta, e o operador pode gerar a reposição.

As reservas obedecem à ordem de liberação. Só concluir as impressões não marca a venda como pronta: a montagem deve atingir a quantidade da OP. Uma OP inteiramente atendida por estoque existente pode ser concluída sem criar impressões artificiais. Materiais/cores da OP permanecem congelados; reposições abertas dentro da OP usam essa versão.

## Integridade e limites

- Opt-in por produto. Não recalcula ou recebe retroativamente produções existentes.
- Saldos separados por placa e identidade de material/cor. Alterar a receita não mistura os saldos das versões anteriores.
- Entradas existentes, aprovações, montagens e perdas possuem chave de repetição. Custos reais e consumo não são duplicados.
- Lotes e alocações de montagem preservam origem, custo e quantidade. RLS separa empresas; mutações usam RPCs autorizadas.
- Quantidades são conjuntos inteiros para uma unidade final. Peças diferentes na mesma placa que precisem de estoques independentes exigem placas/componentes separados; ferramentas reutilizáveis não são consumidas pela montagem.
- O comando “Produzir lote” cria a fila do ERP. Não envia start físico para impressoras; a integração existente acompanha/apura as execuções.
- O painel de montagem apresenta o custo dos produtos montados. O relatório legado de margem por impressão continua baseado nos custos e receitas atribuídos aos jobs; não representa uma apuração completa de margem comercial de montagens atendidas por estoques anteriores.

## Referências e validação

A descrição pública do [modelo fornecido](https://makerworld.com/pt/models/2626659-thermoformed-apple-teacher-appreciation-gift) foi inspecionada no navegador: trata-se de uma maçã termoformada, com acabamento após a impressão. O perfil “Kit Completo (PLA)” tem uma placa; o perfil “Apple Only - Multi Color (Gyroid)” (2899977) tem as três placas descritas pelo usuário. A configuração A1 (836978891) separa corpo, caule e folha, com previsões de 11 g, 3 g e 3 g. Esses valores pertencem ao arquivo de referência: lotes personalizados precisam de seus próprios rendimentos e previsões. Não foram inventados rendimentos, custos ou correspondências com os filamentos do estoque.

O [modelo de SKUs do Printago](https://docs.printago.io/docs/commerce/sku-management) distingue produto vendável e partes com requisitos próprios. A implementação local usa as placas e receitas já existentes no Forge.

Testes isolados PostgreSQL cobrem a maçã, lotes independentes, sobras, repetição, reservas concorrentes em sequência, montagem parcial, estoque pronto, OP sem novas impressões, falhas atômicas, separação de empresas e cores, consumo Bambu, rejeição parcial, lotes em andamento e perdas na termoformagem. O roteiro Playwright cobre planejamento, montagem, perdas e qualidade em 1440 e 390 pixels, com APIs simuladas e sem criar registros no ambiente real.
