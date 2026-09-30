# Plano de melhoria dos fluxos 3D

Autorizado pelo usuário após a análise do Bagulhos3D. Referência funcional do ERP:
GestãoClick. Implementação própria no Forge; não foi localizado repositório do
Bagulhos3D e nenhuma mensagem deve ser enviada ao Lovable.

## Ordem e critérios de aceitação

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
