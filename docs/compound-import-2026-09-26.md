# Importação de produtos compostos

O cadastro agora recebe a composição antes de salvar: produto principal, descrição,
galeria, placas, fotos técnicas e objetos nomeados da configuração escolhida. A
gravação usa uma única transação e a mesma chave de repetição do cadastro.

As peças ficam em `product_print_plate_parts`, vinculadas ao produto e à placa.
O saldo operacional continua sendo o conjunto de peças necessário para uma unidade
do produto final. Um objeto do fatiador não é automaticamente uma unidade vendável.
Novos produtos compostos ativam o fluxo existente de lotes e montagem conforme a
opção apresentada na prévia. Nomes e rendimento corrigidos depois da importação são
preservados na atualização da fonte.

Quando os nomes não vêm no link, a leitura local de um projeto Bambu Studio/OrcaSlicer
3MF preenche objetos e quantidade de cópias por placa. Submalhas de cor não viram
peças separadas. O usuário pode confirmar que o arquivo forma uma unidade do produto,
preenchendo as quantidades de uma vez. Arquivos com distribuição de placas diferente
do perfil selecionado são recusados. Os nomes são os gravados no arquivo; nomes
técnicos genéricos continuam exigindo identificação. Não há reconhecimento visual
automático das peças.

## Limitação verificada no exemplo da maçã

O endpoint público do modelo 2626659, perfil 2899977/configuração A1 836978891,
retorna descrição, fotos, três placas e seus pesos/tempos, mas os nomes das placas
estão vazios e `objects` não contém entradas. A configuração A1 mini de outro perfil
inverte a ordem das placas. Não é correto aplicar nomes pelo número ou pela cor.
O download 3MF direto sem autenticação responde que exige login. Portanto, a
identificação completa desse exemplo somente pelo link ainda não está resolvida.

## Validação

- 400 testes Vitest passaram (incluindo 8 novos casos da composição e do leitor 3MF).
- 7 cenários PostgreSQL novos: gravação atômica, repetição, atualização, isolamento,
  preservação manual, rollback e rejeição de identidade/quantidades inválidas.
- 13 cenários de importação de placas e 13 de estoque/montagem passaram.
- Navegador isolado: metadados reais da maçã, fotos públicas reais e 3MF sintético;
  tamanhos 1440×900, 1108×580 e 390×720. Descrição traduzida simulada nesse teste.
- Banco publicado: transação de teste com metadados reais, três componentes e fotos
  na consulta de produção; repetição validada e rollback. Catálogo permaneceu vazio.
- Versão publicada conferida no navegador: link da maçã, perfil multicolorido e
  configuração A1; descrição traduzida pelo serviço real, 14 imagens do modelo e
  as três fotografias técnicas renderizadas. O rascunho foi fechado sem salvar.
- Dois outros modelos públicos passaram pela mesma importação: caixa 3028621,
  perfil 3403607 (quatro placas), e calendário 2057487, perfil 2221070 (nove placas).
  Ambos preservaram descrição e fotos; os nomes informados no calendário foram
  aproveitados. Nenhum deles foi cadastrado no banco da empresa.
- TypeScript e build de produção passaram. Nenhuma mensagem enviada ao Lovable.

Os testes não comprovam reconhecimento semântico de qualquer geometria nem a leitura
do arquivo 3MF original da maçã; comprovam os dados públicos e o formato de metadados
do projeto usado nos cenários. Evidências visuais locais: `artifacts/imported-composition`.

## Estado do plano

1. Reproduzir a perda de descrição, fotos e composição: concluído.
2. Importar e persistir produto, placas e peças fornecidas pela fonte: concluído.
3. Conferir antes de salvar e gravar sem duplicação: concluído.
4. Publicar e verificar a maçã e outros produtos compostos: concluído para os
   dados que a fonte fornece; identificação semântica completa continua pendente.

A última pendência não foi substituída por reconhecimento fictício. Se o perfil
não expõe os objetos, a leitura de 3MF está disponível; o reconhecimento geral
de nomes e quantidades a partir das imagens exigirá uma integração adicional.
