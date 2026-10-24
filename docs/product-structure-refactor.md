# Produto, peças e produção

## Objetivo
Manter um produto como ponto de entrada para suas peças, estoque e montagem. Cada peça tem identidade, estoque e ficha técnica próprios e pode ser usada em mais de um produto. Arquivos e placas descrevem a impressão; não substituem as peças físicas.

## Entrega
- [x] Catálogo separado em produtos completos e peças, com navegação nos dois sentidos.
- [x] Página do produto com composição visível, edição de peça em contexto e estoque/montagem.
- [x] Salvar identidade, quantidade, custo, ficha técnica e preparação da peça em uma transação.
- [x] Impedir transformação silenciosa de produto vendável em peça e manter histórico de produção.
- [x] Tratar falhas na leitura do estoque sem inventar um plano de produção alternativo.
- [ ] Testes de regressão, publicação e conferência do catálogo real.

## Preservação dos dados
Não recriar os produtos, zerar estoque, estimar consumo de peças diferentes dividindo o total da placa nem atribuir peças a placas sem confirmação. Os dados técnicos desconhecidos permanecem pendentes e visíveis. Montagem manual continua disponível sem exigir arquivo de impressão.

## Validação
Em 24/10/2026: 779 testes de interface/lógica passaram na CI; 14 cenários novos de banco cobrem transação, permissões, estoque, fichas, rendimento de placas mistas, impressão e produção congelada. TypeScript e build locais passaram. O teste de salvamento no banco publicado foi integralmente revertido: permanecem seis produtos, quatro peças na composição e zero movimentações.
