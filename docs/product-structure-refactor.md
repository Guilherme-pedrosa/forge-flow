# Produto, peças e produção

## Objetivo
Manter um produto como ponto de entrada para suas peças, estoque e montagem. Cada peça tem identidade, estoque e ficha técnica próprios e pode ser usada em mais de um produto. Arquivos e placas descrevem a impressão; não substituem as peças físicas.

## Entrega
- [ ] Catálogo separado em produtos completos e peças, com navegação nos dois sentidos.
- [ ] Página do produto com composição visível, edição de peça em contexto e estoque/montagem.
- [ ] Salvar identidade, quantidade, custo, ficha técnica e preparação da peça em uma transação.
- [ ] Impedir transformação silenciosa de produto vendável em peça e manter histórico de produção.
- [ ] Tratar falhas na leitura do estoque sem inventar um plano de produção alternativo.
- [ ] Testes de regressão, publicação e conferência do catálogo real.

## Preservação dos dados
Não recriar os produtos, zerar estoque, estimar consumo de peças diferentes dividindo o total da placa nem atribuir peças a placas sem confirmação. Os dados técnicos desconhecidos permanecem pendentes e visíveis. Montagem manual continua disponível sem exigir arquivo de impressão.
