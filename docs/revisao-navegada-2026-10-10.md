# Revisão com navegação e reprodução de casos — 10/10/2026

Esta revisão aprofunda a avaliação do Forge Flow após a entrega da PR #1. A base examinada é `aceb02e449517cb2b2520f5f16fa60a0d588aa03`. Foram usados navegador Chromium, páginas públicas, um manual hospedado pelo MakerWorld, um 3MF oficial do Bambu Studio, o código dos dois sistemas e banco isolado com dados sintéticos. A [matriz de cobertura](coverage-2026-10-10.md) continua registrando o que falta para atender integralmente a entrevista.

A [reconferência direta do Plaud](revisao-plaud-2026-10-10.md), posterior a esta revisão, registra omissões adicionais e corrige a prioridade de TikTok e a classificação do controle real de filamento.

## O que foi acessado

| Fonte | Acesso efetivo | Evidência e limite |
| --- | --- | --- |
| Integrador WeDo no Lovable | Metadados do projeto e navegação no endereço publicado; tela de autenticação. | As telas internas da conta real não foram acessadas. Nenhuma mensagem foi enviada ao Lovable. |
| Telas de anúncios, catálogo, pedidos e configuração do Integrador | Reprodução local das telas do código, SHA `6aa1e9146689755da8b17463baaf23c9471f0c84`, com dados sintéticos e rede externa bloqueada. | Permite avaliar apresentação e interações locais. Não comprova sincronização, permissões, dados do vendedor ou operação real. Código privado e capturas internas ficam fora deste repositório público. |
| Anúncios brasileiros de lojas de impressão 3D | Páginas abertas em navegador; descrição, variantes, preço anunciado e campos de personalização examinados. | Preços são observações em 10/10/2026. Nenhuma compra foi feita. Não se confirmou o recebimento físico dos itens anunciados. |
| Mercado Livre e Shopee públicos | Tentativas de navegação registradas. | Mercado Livre retornou HTTP 403; Shopee falhou no túnel do proxy. Resultados indexados não foram tratados como inspeção da página ou da conta. |
| Três páginas de modelos e início do MakerWorld | Tentativas de navegação e respostas registradas. | HTTP 402, com mensagem de acesso bloqueado. Placas dessas páginas não foram apresentadas como observação direta. |
| Manual de mapa hospedado pelo MakerWorld | PDF público baixado e páginas de composição, placas e montagem examinadas. | Documento de criador; não substitui a página do modelo nem confirma seus perfis atuais. |
| 3MF oficial do Bambu Studio | ZIP inspecionado e leitor real do Forge executado. | Arquivo de calibração, não arquivo dos três projetos bloqueados. Nove objetos reconhecidos; rendimento comercial, consumo e tempo permanecem desconhecidos. |
| Forge Flow | Código e funções reais executados em PGlite; interface exercitada com respostas sintéticas. | Banco e contas operacionais não foram modificados. PGlite não comprova concorrência real do PostgreSQL de produção. |

## Casos reais que mudam o desenho do ERP

| Caso observado | Fonte | Consequência operacional |
| --- | --- | --- |
| Kit de seis animais específicos, apresentado em cápsula acrílica; R$ 23,90. | [Migles Mini Labs](https://miglesminilabs.com.br/produtos/kit-de-miniaturas-animais-do-campo-1dnjn/) | Uma venda de quantidade 1 exige seis peças e a embalagem. Se uma placa imprime quatro peças, elas não podem dar entrada como quatro kits. A composição fixa deve identificar cada espécie. |
| Coleção com um seletor que reúne kits e temas; variante de 25 unidades e variante Safari têm IDs e preços distintos. | [Studio Xapê](https://studioxape.com.br/products/colecao-de-miniaturas-articuladas-de-animais) | O vínculo precisa considerar a variante efetivamente vendida. Não inventar dois eixos independentes de quantidade e tema. A imagem de um sortimento aleatório não define uma composição fixa. |
| Luminária com nome obrigatório; anúncio também oferece fonte e cor sob consulta; R$ 89,90. | [3D MHA Studio](https://3dmhastudio.com.br/produto/luminaria-personalizada-mickey-led-impressao-3d-nome/) | SKU e produto vinculado não bastam para liberar o arquivo da venda. O nome e as escolhas do comprador precisam de conferência por item. Estoque genérico não prova que a personalização está pronta. |
| Litofania com foto enviada depois da compra, base LED inclusa e produção anunciada de dois dias úteis; R$ 89,70. | [Imprimaria 3D](https://imprimaria3d.com/produto/luminaria-personalizada-foto) | Pagamento confirmado ainda pode anteceder o recebimento da foto. Base em estoque e painel personalizado são estados distintos. O prazo de produção do anúncio não é o horário oficial de despacho da venda. |
| Manual de mapa com clips, pinos, blocos, peças opcionais e opções diferentes de legenda. | [PDF hospedado no MakerWorld](https://makerworld.bblmw.com/makerworld/model/US43a5623d8e34cd/design/2025-02-13_8eb2c631063a2.pdf) | A tabela pede 124 clips para USA, 85 para Canada ou 131 para Europe; 20 pegs e 40 pins. As placas 11, 12, 13+14 e 15 representam opções de legenda. Imprimir todas as placas adiciona componentes desnecessários. Há texto personalizado e material não impresso para instalação. |
| 3MF de calibração com nove corpos, sem dados de fatiamento ou distribuição Bambu por placa. | [Bambu Studio, arquivo oficial versionado](https://raw.githubusercontent.com/bambulab/BambuStudio/47a13eeb1d9af65ef2371e361c856e21d4f6ca72/resources/calib/filament_flow/flowrate-test-pass1.3mf) | Quantidade de objetos geométricos não determina quantidade vendável, composição ou peso. O leitor conservou os campos desconhecidos; não foi encontrado defeito nessa leitura. |

O PDF tem SHA-256 `6ea48c1e37b2eb77ec641a32fb7b82ff58c14b9b9b62afd8efbe0ddaf03fa889`. Capturas e resultados completos de navegação ficam no caderno de evidências local, separado de dados e fontes privadas do Integrador.

## Modelo operacional recomendado

Antes de automatizar uma venda, definir a unidade comercial: peça, kit fixo, sortimento ou serviço. A quantidade comercial permanece a quantidade cobrada. Ela se desdobra em componentes necessários e esses componentes se desdobram nas execuções físicas das placas.

Uma placa precisa declarar suas saídas: por exemplo, dez corpos e três tampas. Um produto que usa dois corpos e uma tampa pode aproveitar excedentes de corpos, mas só fica montável quando há tampas suficientes. O número de produtos montáveis é determinado pelo componente limitante. Perfil de impressora, bico, material, cor e configuração de AMS pertencem à receita de fabricação escolhida.

Peças reaproveitáveis devem ter identidade de estoque confirmada. Mesmo nome ou geometria semelhante em duas placas não prova equivalência comercial. Placas alternativas precisam ser selecionadas como uma rota; perfis preservados como referência ainda não constituem essa seleção no Forge.

Para personalização, o estado produtivo deve registrar o que falta do comprador, a revisão da arte e o arquivo daquela venda. A barreira de conferência desta revisão é uma proteção inicial configurável por vínculo; não implementa aprovação de arte ou anexos por item. Ative a organização automática apenas depois de revisar os vínculos e suas exigências.

No custo, separar a impressão da unidade comercial e do pacote de envio. Filamento, purga, suportes, máquina, preparação e retirada pertencem à execução. Acabamento e montagem pertencem ao produto; caixa e proteção pertencem ao pacote. Taxas, frete e impostos usam as bases reais do canal. Preço anunciado e líquido repassado não representam o custo de fabricação nem a base fiscal completa.

No Forge, custo real de placa mista ainda é distribuído por quantidade de peças boas. Essa regra preserva o total, mas pode distorcer a margem de uma peça grande e outra pequena. Um rateio por massa ou tempo exige dados confirmados por objeto e uma regra explícita para purga, suporte e custos compartilhados.

## Diferenças de jornada frente ao Integrador

A reprodução local mostrou uma jornada própria de anúncios, agrupamento por produto comercial, identificação de erros de sincronização e leitura separada de preço, saldo e despacho. A jornada de publicação usa o catálogo do ERP integrado. Ela não substitui ficha técnica, controle de filamento ou montagem de uma farm.

A revisão adiciona ao Forge uma gestão manual de vínculos por conta, independente da primeira venda. Ela permite corrigir o produto associado a uma identidade externa já ativa, com paginação e isolamento do formulário na troca de conta. A configuração fica recolhida durante o atendimento cotidiano. O acesso ao pedido interno passa a abrir seu detalhe diretamente.

Essa gestão não importa o catálogo remoto de anúncios, não publica saldo/preço e não oferece o conjunto completo de edição, pausa e auditoria do Integrador. Essas capacidades continuam pendentes. A navegação local também mostrou que uma tabela extensa pode esconder ações no lado direito; copiar sua densidade visual sem observar uso em celular não atenderia ao objetivo de reduzir burocracia.

## Falhas reproduzidas e correções

Os resultados abaixo partem de funções reais da base examinada, com entradas sintéticas. Os scripts desta revisão são os contratos reproduzíveis das correções.

| Caso | Comportamento da base | Tratamento nesta revisão |
| --- | --- | --- |
| Vínculo antes da primeira venda ou correção de produto ativo | O formulário de vínculo dependia dos itens do inbox e não permitia corrigir um vínculo para outro produto ativo. | Gestão própria de vínculos por conta, edição do destino e acesso direto ao pedido. |
| Personalização aguardando dados do comprador | Produto genérico vinculado podia passar pela elegibilidade automática, sem contrato para nome/foto/arte. | Exigência explícita de conferência por vínculo bloqueia organização automática e em lote. Confirmação manual continua sendo responsabilidade da revisão do pedido. |
| Produção para estoque de kit | Quatro peças geradas eram recebidas como quatro kits. | Proteção de recebimento impede converter contagem de componentes em saldo de kits sem composição física adequada. |
| Produção com variante de material/cor para estoque | Produção vermelha podia dar entrada no estoque base preto. | Recebimento exige identidade de estoque coerente; não credita a variante no saldo base. |
| Oferta pendente de venda cancelada | Impressões ligadas à venda cancelada ainda eram consideradas para cobrir a próxima demanda. | Planejamento desconsidera oferta de venda/OP cancelada. Hoje, Fila, simulação e reposição retiram trabalho ainda não iniciado dessas origens, inclusive quando a venda está ligada somente pela OP. Histórico e execuções físicas permanecem para apuração. |
| Execução parcial sem rejeição adicional no QC | Uma execução que terminou com cinco peças podia aprovar todas as cinco, sem gerar reposição para uma demanda efetiva de seis. | A reposição considera a falta frente à demanda, mesmo quando todas as peças realmente produzidas foram aprovadas. Se a demanda é cinco e a capacidade planejada seis, não exige fabricar o excedente. |

O teste de placa com rendimentos desiguais foi um controle positivo: duas execuções, montagem de cinco produtos e sobra de dez corpos e uma tampa estavam corretas. Não foi anunciado como falha. A importação do mesmo objeto em duas placas produziu dois SKUs provisórios; a equivalência precisa de confirmação, e esta revisão não os unifica automaticamente por nome.

A venda de um kit também ainda não aproveita corretamente o estoque pronto dos produtos filhos nesse caminho: a reprodução manteve três peças prontas e criou impressões adicionais. A proteção de recebimento desta revisão impede saldo errado, mas não completa a reserva, o consumo e a composição comercial do kit. Essa é uma pendência concreta de implementação.

## Aceite que ainda falta para resolver a entrevista inteira

A fala de Gleyce em 00:00:47–00:01:28 exige entrada automática de vendas ML/Shopee/TikTok, fila pelo prazo de postagem com folga e pedidos particulares no mesmo local. Em 00:01:57, ela pede visão real do filamento das três máquinas para consolidar a compra. A revisão não muda esses critérios.

Para o núcleo explícito do Plaud, ainda faltam entrada contínua dos três canais com recuperação de eventos/cancelamentos, atendimento de todos os pedidos na mesma página e controle físico confiável dos filamentos das três máquinas para comprar junto. TikTok pertence a esse aceite original. Agenda persistida, rotas alternativas, aprovação de arte, expedição, gestão completa de anúncios e atualização remota de estoque são evoluções ligadas ao ERP mais amplo solicitado pelo usuário ou recomendações técnicas; não foram todas exigidas literalmente nesta gravação. Credenciais ausentes limitam o aceite externo; não explicam funcionalidades ainda não implementadas.

O piloto deve atravessar: produto simples; kit com quantidade comercial 1 e vários componentes; produto composto com rendimentos desiguais; variante de cor; personalização sem foto seguida de conferência; estoque parcial; perda que exige reposição e sobra que não exige; venda cancelada; duas contas com IDs externos semelhantes; compra de cores das três máquinas em um documento. Medir minutos administrativos por pedido, atraso, retrabalho e diferença de inventário. Só então afirmar que a dificuldade relatada foi resolvida na operação.

GitHub conectado ao Lovable sincroniza código conforme a configuração do projeto. Isso não prova aplicação das novas migrações, publicação das funções, autorização do vendedor ou passagem do piloto. A validação desta revisão registra separadamente código testado e operação real.

## Validação da revisão

Com os arquivos de código congelados, a conferência local final passou em 10/10/2026:

- `npm run typecheck` e `npm run build`.
- `npm test`: 681 testes em 69 arquivos.
- `npm run test:operations`: 153 contratos de operação, incluindo 14 para a barreira de conferência e 12 para identidade de estoque e oferta cancelada.
- `npm run test:database`: 54 cenários de banco.
- `npm run test:operations:ui`: navegação em 1440 e 390 pixels, com respostas sintéticas e sem gravações. A gestão de vínculos também foi exercitada separadamente nos dois tamanhos.

Os contratos físicos novos foram executados sem a migração 1100: sete falharam e cinco controles positivos passaram. Após a migração, os 12 passaram. A barreira de conferência também foi reproduzida antes da correção, incluindo o caso de rascunho já aprovado. Os testes verificam permissões, isolamento entre empresas, repetição de chamadas e rollback; não comprovam concorrência real no PostgreSQL de produção.

A revisão independente não deixou achado confirmado pendente neste conjunto de alterações. Isso não encerra as lacunas de produto nem substitui a aplicação das migrações e o aceite operacional descritos acima.
