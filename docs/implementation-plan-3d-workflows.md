# Plano de melhoria dos fluxos 3D

Autorizado pelo usuário após a análise do Bagulhos3D. Referência funcional do ERP:
GestãoClick. Implementação própria no Forge; não foi localizado repositório do
Bagulhos3D e nenhuma mensagem deve ser enviada ao Lovable.

## Ficha técnica individual — 01/10/2026

- Cada SKU de subitem tem uma ficha compartilhada por todas as suas composições:
  múltiplos filamentos/cores, gramas por material, impressão e acabamento por peça,
  rendimento de placa, custo de filamento/máquina/mão de obra/outros e observações.
- Entrada por peça ou placa de peças iguais; conversão explícita para gramas e
  segundos por peça. Trocar a base mantém o valor equivalente. Dados desconhecidos
  continuam nulos; custo técnico não sobrescreve o custo histórico do estoque.
- Placa vinculada que contém somente um subitem identificado fornece automaticamente
  peso e tempo divididos pelo rendimento confirmado. Placas mistas e peças não
  identificadas não recebem rateio sem informação. A ficha manual prevalece.
- Composição e tela de montagem mostram a ficha de cada peça e a previsão de
  reposição: descontam estoque/fila e arredondam pelos lotes conhecidos, incluindo
  saídas extras de placas mistas. Tempo é estimativa equivalente, não prazo de entrega.
- Ordens liberadas e impressões guardam a ficha junto da composição aprovada.
  Atualizações posteriores não reescrevem a referência desses trabalhos.
- Corrigido também o estado do editor: abrir a peça a partir do produto pai não
  herda um rascunho nem bloqueia indevidamente o botão Salvar.
- Validação: 416 testes da suíte completa e um novo teste adicional de troca de
  base; 21 cenários PostgreSQL; navegador em 1440 e 390 px, incluindo salvar ficha
  pelo cadastro da peça. Typecheck, lint dos módulos novos e build aprovados.
- Migração 20260930040000 aplicada no banco publicado. Teste transacional conferiu
  ficha com 8 g, custo técnico R$ 2,39 e necessidade de 100 peças para 50 produtos;
  rollback confirmado com zero cadastros de teste remanescentes.
- Limite concreto da maçã: seus quatro subitens estão cadastrados, mas não há
  vínculo confirmado entre cada geometria e a placa/rendimento. O perfil público
  disponível não fornece consumo individual. Não foram inventados pesos/tempos.
- Publicado: commit 6b8a34a, implantação 38ee2b75-987a-4f05-939e-a6b7a6bfb544.
  O site servido contém a previsão técnica e os métodos de leitura/salvamento da
  ficha (index-BBYz0O2O.js / AssemblyWorkspace-D6Ji0jAj.js /
  ImportedModelImage-CBINCTxl.js). A sessão autenticada do Chrome ficou
  indisponível: a ferramenta pediu atualização da extensão. Testes visuais de
  desktop/celular são locais; não foram apresentados como verificação visual
  autenticada da publicação. O navegador integrado permanece na tela de login.

## Ordem e critérios de aceitação

**Correção prioritária em 30/09:** a implementação anterior identificava peças,
mas armazenava estoque por conjunto de placa. Isso não atendia ao requisito.
Antes de qualquer outra melhoria, cada peça passa a ser um produto real com SKU,
estoque próprio e quantidade na composição do produto final. Uma placa pode
produzir vários subitens, conferidos separadamente. A montagem consome a quantidade
de cada peça e capitaliza o produto pronto, preservando reservas e histórico.
As outras melhorias abaixo já estão implementadas; não substituem esta correção.

1. **Composição visual** — abrir STL/3MF localmente, visualizar e selecionar objetos,
   conferir nomes/quantidades e usar os componentes no produto. Preservar a distinção
   entre objeto, região de cor, placa e unidade comercial. Não anunciar reconhecimento
   semântico por imagem quando a fonte não o fornece.
2. **Precificação** — simular sem cadastrar previamente, considerar materiais,
   máquina, energia, trabalho, extras e reserva de perdas; comparar lote/unidade,
   preço alvo e margem sobre a venda; levar os valores ao produto/orçamento.
3. **Etiquetas** — produzir PDF com nome, SKU, preço e QR de endereço ou Pix estático,
   com validação do conteúdo e prévia. Gerar código não confirma pagamento.
4. **Consignação** — apurar vendas e devoluções do ponto numa conferência, preservar
   saldo, comissão, financeiro e repetição segura da operação.
5. **Validação e publicação** — testes de cálculo e arquivos, banco e fluxos visuais;
   verificar código publicado e os fluxos possíveis na sessão autenticada.

## Estado

- Correção de estoque individual: cada subitem é um produto do catálogo com SKU
  e item de estoque próprios. A composição tem quantidade por produto, placa
  opcional e quantidade por impressão. Entrada/perda funcionam sem receita.
- A importação cria os cadastros das peças identificadas automaticamente. Placas
  sem objetos identificados não são apresentadas como peças cadastradas.
- A montagem consome as quantidades físicas (ex.: duas metades), preserva as
  reservas das OPs e registra o custo do produto pronto. Uma placa mista aprova
  cada peça separadamente; seu custo total é rateado pelas unidades aprovadas.
- Validação desta correção: 15 cenários PostgreSQL específicos, mais 13 legados de
  montagem, 9 de importação, 54 de ERP e 23 de orçamento. Fluxo visual de cadastro,
  entrada, montagem e qualidade aprovado em 1440 e 390 px; 412 testes Vitest.
- Banco real: migrações 20260930030000 e 20260930031000 aplicadas. Teste transacional
  confirmou 20 metades, 10 caules e 6 folhas -> montagem de 5 -> saldos 10/5/1 e
  5 produtos finais. Repetição não duplicou. Rollback deixou zero produtos de teste.
- Publicado e conferido em 30/09: commit 47efcee, bundle AssemblyWorkspace-D4P3j_Dl.
  A maçã existente tem quatro produtos filhos: metade 1, metade 2, caule e folha,
  cada um com SKU e estoque zero próprios, uma unidade de cada por produto final.
  A tela publicada mostrou os quatro saldos e abriu a entrada de uma peça sem
  exigir receita ou impressora. O perfil antigo Full Kit foi preservado; não se
  associaram peças a placas nem rendimentos sem confirmação do arquivo correto.

- Implementado: leitor visual STL/3MF, seleção dos objetos e composição local
  salva atomicamente com o novo produto. O leitor suporta componentes internos da
  extensão Production do 3MF e preserva os objetos físicos com múltiplas regiões.
- Implementado: calculadora com vários materiais, impressão/trabalho, extras por
  lote/unidade, reserva de falhas, margem de venda e preço alvo. Transferência para
  produto novo (com custo manual) e orçamento novo, incluindo produtos existentes.
- Implementado: etiquetas PDF A4 de 62 x 44 mm, 18 por página, preço/SKU e QR URL
  ou Pix estático. Exemplo oficial BCB confere integralmente, inclusive CRC 1D3D.
- Implementado: conferência conjunta de vendas/devoluções, comissão e contas a
  receber, com bloqueio de saldo/preço/comissão desatualizados e repetição segura.
  Envios de produtos com estoque vinculado agora baixam o estoque central;
  devoluções de unidades transferidas o recompõem. Não há migração retroativa de
  quantidades antigas. A base publicada tinha zero movimentos consignados na revisão.
- Validação: 410 testes Vitest, 54 cenários PostgreSQL de ERP, 23 de orçamento,
  13 de montagem e 9 de importação/conferência. Typecheck, lint dos módulos novos
  e build aprovados. Testes de navegador em 1440 e 390 px percorrem calculadora →
  produto → orçamento, importação de 3MF, PDF real e conferência consignada.
- PDF renderizado e inspecionado; 19 etiquetas em 2 páginas, com todos os SKUs e preços.
- Em andamento: publicação e conferência da versão publicada.
- Banco publicado: migrações aplicadas e registradas em 2026-09-30. Teste no banco
  real criou produto com duas peças e saldo 20, enviou 10 ao ponto, vendeu 3 e
  recolheu 2: saldo central 12, ponto 5, repasse 48. Repetição não duplicou operação.
  Rollback confirmado, com zero produtos/clientes de teste remanescentes.
- Limite conhecido: nomes semânticos de peças omitidos no link MakerWorld não podem
  ser tratados como informação confirmada; a leitura do projeto complementa os dados.
- Limites do leitor: geometria de malha, até 80 MB compactados / 120 MB de XML e
  1 milhão de triângulos; STL não fornece nomes internos ou distribuição por placa.
  Geometria não é salva como arquivo de produção nem enviada à impressora. As peças
  identificadas alimentam a composição; material, arquivo aprovado e impressora
  continuam sendo preparados no fluxo de produção existente. Leitura visual validada
  com arquivos sintéticos; o 3MF privado da maçã não estava disponível nesta sessão.
- Referência do Pix: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
