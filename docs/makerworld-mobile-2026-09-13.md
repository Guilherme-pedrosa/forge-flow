# Fechamento do produto e importação MakerWorld

Base: `9400e931e8185e5e9694a8891f6c79a5a49c228c`. Branch de preparação: `Codex/local-preparacao-makerworld-fechamento`.

## Problemas encontrados

- O editor tratava composição em edição, janela de receita aberta e download como gravações em andamento. O botão X aparentava estar ativo, mas o callback recusava o fechamento.
- O importador antigo consultava um endpoint MakerWorld que devolveu HTTP 403. O parser ignorava `instances`, `instanceFilaments`, `usedG` e `extention.modelInfo.plates` da resposta pública atual.
- O frontend descartava peso e tempo, limitava a galeria a cinco fotos extras e escolhia um material do estoque pelo nome, sem conferir a cor. As placas viravam somente uma anotação.

## Correções

- Escrita, consulta e rascunho têm estados distintos. X/Cancelar encerram o rascunho; uma escrita real bloqueia a saída de forma visível. Salvar o cadastro não descarta uma composição ainda em edição.
- X e ações principais têm área de toque de 44 px. Nome, categoria e descrição aparecem no início do formulário; galeria e ficha técnica podem ser consultadas sem uma lista excessiva de imagens de placas.
- A aplicação consulta diretamente o serviço público de design da Bambu por RPC, via `pg_net`, sem credenciais Bambu e sem executar o agente Lovable. Nenhuma alteração de Edge Function é necessária para esse fluxo.
- O parser determinístico mantém fotos, descrição, autor, licença, tags, arquivos e instruções disponibilizados pela origem, além de todos os perfis, variantes de impressora, placas, filamentos, cores e previsões de tempo e peso.
- Fotos do produto ficam na galeria. Imagens técnicas de placas permanecem em suas configurações e no conjunto completo de metadados. A interface pode recolher imagens; o salvamento não corta a galeria silenciosamente.
- `products.external_import`, fotos e fonte de impressão são salvos na mesma transação, com repetição segura. Atualizações comuns preservam a referência e os vínculos Bambu anteriormente verificados.
- Produtos antigos importados do MakerWorld passam a oferecer **Atualizar fotos e detalhes do link**. A consulta não troca nome, preço ou composição manual. A revisão só é persistida ao salvar.

## Evidência da origem

Consulta pública de 13/09/2026: [modelo 1169522](https://makerworld.com/en/models/1169522), por [serviço de design Bambu](https://api.bambulab.com/v1/design-service/design/1169522).

- Resposta HTTP 200, aproximadamente 117 KB, título `Gomu-Gomu No Mi Keychain`.
- Dois perfis públicos, com configurações por impressora. O perfil público `1177581` tem configuração P1S `241221531` e A1 `824279339`; esses identificadores têm significados diferentes.
- Na configuração A1 citada: duas placas, 12 g + 1 g, PLA nas cores `#996699` e `#FFCC66`, total de 4.601 segundos previstos.
- O segundo perfil público `3696467` tem outra composição de placas, totalizando 189 g. Não se deve selecionar uma configuração apenas pelo título do produto.
- Três fotos de produto e 31 imagens totais incluindo as prévias técnicas. Três arquivos STL são listados; a resposta pública não fornece seus endereços de download.

## Limites explícitos

O serviço de design é uma integração pública observada, sem garantia de contrato estável. Quando um projeto não é público ou a origem não fornece um campo, o aplicativo informa a pendência. Não inventa dados. Links de ferramentas/projetos privados MakerLab precisam de um modelo publicado no MakerWorld ou do arquivo exportado.

O número de objetos de uma placa não determina o rendimento comercial. Os dados externos permanecem como referência até a confirmação do rendimento e da composição com os materiais e cores do estoque. Importar o link não movimenta estoque, não altera receitas aprovadas e não envia comandos à impressora.

Consulta limitada a cinco novos modelos por minuto por empresa, três pendências simultâneas, cache de dez minutos, resposta de até 2 MB e timeout de rede de dez segundos. A galeria aceita até 100 fotos extras; excesso é recusado explicitamente. O `pg_net` não limita bytes durante o transporte; o limite de tamanho é aplicado antes de interpretar e devolver a resposta.

## Validação

Testes de parser, interface, ciclo de fechamento, persistência PostgreSQL, isolamento entre empresas, repetição, rollback e limites. QA pelo navegador em 320, 390 e 1440 px, com dados locais fictícios e a resposta pública real do modelo. Imagens carregaram e o X devolveu a tela ao catálogo. Isso não substitui um teste físico do teclado do iPhone.

Resultado: 281 testes frontend aprovados (suite completa e repetição focada após corrigir a expectativa da contagem de cores), 141 cenários PostgreSQL, typecheck, build e verificação de whitespace.

A migration 039 foi aplicada por ferramenta direta de banco, com checksum MD5 `cb744775662b4d42a349154d90b6e0f0`, igual ao arquivo local. A consulta pública executada pelos novos RPCs no servidor real retornou status `ready`, ID 1169522 e dois perfis. Não foram criados produtos, pedidos, receitas, movimentos de estoque nem lançamentos financeiros para validar o ambiente real.

Entrega por GitHub e publicação direta de hosting; nenhuma mensagem ao agente Lovable.
