# Reconferência do Plaud — 10/10/2026

Esta revisão usa a base `71ed9bbfe2de659f63b44b7bcfc33489106cb571`, após a PR #2. Foi consultado diretamente no Plaud o registro **“10-10 Reunião de Diagnóstico: Gestão de Pedidos, Fila de Impressão 3D e Controle de Estoque”**, com duração de 7min22s. Foram lidas as 23 falas do bloco original, com `next_cursor=null`, e a nota automática. A transcrição corresponde ao arquivo anexado pelo usuário. Não há marcações de destaque disponíveis.

A nota automática é uma interpretação secundária: seus itens de ação não foram tratados como novas decisões explícitas de Gleyce. Não foi ouvido o áudio nesta reconferência. A fonte completa fica no caderno local privado; transcrição integral, links assinados e dados da conta Plaud não são publicados neste repositório.

## O pedido da operadora e o aceite

| Momento | Pedido efetivo | Condição para considerar resolvido | Situação desta revisão |
| --- | --- | --- | --- |
| 00:00:27 | Organizar pedidos e automatizar a fila. | Venda elegível exige apenas tratar exceções, sem repetir cadastro, importar arquivo ou disparar consulta. | Organização após importação existe; entrada contínua permanece incompleta. |
| 00:00:47–00:00:53 | Mercado Livre, Shopee **e TikTok Shop** entram automaticamente. | Os três canais passam por autorização, entrada contínua, atualização e recuperação de falhas/cancelamentos. | ML/Shopee têm consulta e organização no código; TikTok não tem adaptador automático. Os três pertencem ao requisito original. |
| 00:00:53 | Ordem pelo prazo, mostrar até quando postar e ter folga. | Prazo oficial é preservado; meta interna antecede esse limite; operador recebe indicação atualizada. | Comparador existe; precisão do prazo e atualização do Hoje são corrigidas nesta revisão. Ordenação não garante capacidade da farm. |
| 00:01:19–00:01:28 | Cadastrar vendas Instagram/WhatsApp com prazo combinado, um dia antes. | Informar a entrega combinada já dá uma meta de preparação anterior, conservando a promessa ao cliente. | Caminho apenas por DATA não recebia a folga. Correção deriva uma DATA de preparação um dia civil antes para origem interna confirmada; não cria horário oficial. Cadastro ainda não identifica Instagram/WhatsApp como canais próprios. |
| 00:01:28 | Todos os pedidos na mesma página para gerir tudo por lá. | Entradas externas pendentes e vendas internas aparecem na mesma jornada, com tratamento das exceções. | Pedidos convertidos compartilham Pedidos/Hoje; pendentes externos continuam no inbox separado. Ainda parcial. |
| 00:01:57 | Ver filamento real das três máquinas. | Bobina, material/cor, localização, saldo, idade e confiança do dado permitem decidir a próxima compra. | Há cadastro/pesagem/localização; rastreio e reconciliação física continuam parciais. Uma medição antiga não representa automaticamente saldo atual. |
| 00:01:57 | Evitar outra compra/entrega por esquecer as outras máquinas. | Demanda global, reservas, compras já abertas e confiança do inventário são conferidas antes de consolidar a compra. | Agrupamento existe; projeção de reservas, compra já prevista e revisão da chegada recebem correções. A economia real de frete ainda precisa ser medida. |

## O que passou na revisão anterior

**Folga ausente no pedido particular.** Preencher apenas Data de Entrega e confirmar era permitido, mas a folga de 24 horas só era calculada se Postar até existisse. A fila e o Hoje usavam a entrega sem antecipação. A correção centraliza a regra em `deliveryPreparationDay`: para entrega em 12/10, meta em 11/10, sem alteração da entrega e sem transformar uma DATA em horário de postagem. Origem desconhecida, vínculo marketplace e prazos explícitos impedem a inferência. Essa meta calculada não constitui calendário editável/auditado nem considera feriados.

**Prazo oficial truncado.** `datetime-local` exibia minutos. Ao revisar somente a meta, um prazo `23:59:59` voltava como `23:59:00`; a RPC rejeitava a diferença frente ao prazo oficial. A correção conserva segundos, fração e offset do original quando o valor exibido não foi editado. Criação de outro pedido não reutiliza o prazo anterior.

**Hoje aberto não acompanhava outra sessão.** O relógio mudava e a consulta tinha `staleTime`, mas isso não agenda nova leitura. A página passa a consultar novamente a cada 30 segundos enquanto visível. Isso acompanha fatos já registrados no ERP; não implementa entrada contínua dos marketplaces nem alertas externos.

**Compra sem possibilidade de corrigir previsão.** Compras pendentes podiam entrar sem data prevista — inclusive por XML — e ficavam fora da projeção. A tela pedia conferir o prazo, mas não permitia editar o documento salvo. A revisão permite atualizar a previsão sem cancelar/recriar a compra ou alterar itens, estoque e financeiro. Previsão não constitui recebimento físico.

**Compras e reservas não davam uma resposta confiável para recomprar.** Foram reproduzidas sugestão extra apesar de compra pendente com chegada no mesmo dia e omissão de compromisso reservado em trabalho ainda em rascunho. A projeção deve deduplicar receita, reserva e compromisso da OP e distinguir quantidade ainda necessária de risco enquanto a entrada não chega. Reservas inconsistentes exigem regularização; não viram disponibilidade.

**Pesagem antiga permanecia confiável após consumo sem reserva.** O estoque agregado era baixado, mas somente bobinas explicitamente reservadas eram marcadas para pesagem. Assim, uma bobina podia continuar mostrando 1000g medidos após consumo de 200g sem vínculo. A revisão marca a incerteza conservadoramente, sem inventar qual bobina foi usada nem seu novo peso, preservando a baixa única no ledger. A diferença entre bobinas e agregado e as pesagens pendentes precisam ficar visíveis na decisão de compra.

Exemplos reproduzidos nos contratos: com estoque de 1000g, receita de 600g, reserva de 900g e outro compromisso de 200g, a demanda passava incorretamente como 800g; agora é 1100g. Com estoque de 200g, mínimo de 500g e compra de 1000g prevista para hoje, a sugestão extra cai de um quilo para zero, mas os 300g de falta física permanecem visíveis até o recebimento. Tentativa falha não cobre a quantidade ainda necessária da OP: reimpressão e rascunho residual permanecem na demanda, sem contar a tentativa histórica duas vezes.

A revisão independente encontrou duas falhas adicionais antes da publicação: reutilizar a identidade de uma revisão de ETA já concluída após outra sessão alterar a compra e contar uma tentativa falha como cobertura futura da OP. Ambas foram corrigidas, com regressões específicas. Isso não resolve a associação física de bobina em toda troca feita durante uma impressão; esse rastreio ainda exige validação operacional.

## Prioridade corrigida

TikTok foi indevidamente colocado como expansão futura. Ele foi nomeado junto dos outros dois canais e faz parte do aceite inicial, mesmo que o trabalho técnico seja faseado. Controle real de filamento e compra sem surpresa permanecem **parciais**; cadastro de bobina, tela de reposição ou contrato isolado não encerram essas dores.

O Plaud pede fila automática; não pede disparo físico automático da impressora, sensores de peso ou leitura de mensagens do WhatsApp. Financeiro, precificação, placas, embalagem e gestão ampla da farm pertencem ao pedido maior do usuário. Aprovação de arte, rotas alternativas e outras proteções são recomendações necessárias para certos produtos, mas não devem substituir o núcleo da entrevista.

O atendimento de vendas particulares ainda depende de cliente ativo e vencimento financeiro para confirmação. Essa exigência deve ser revista na simplificação da jornada: prazo de entrega, postagem, meta produtiva e data financeira são conceitos diferentes. Compartilhar tabelas e oferecer links entre telas também não satisfaz a exigência de administrar tudo no mesmo lugar.

## Aceite operacional ainda pendente

O teste decisivo é acompanhar vendas dos três canais e uma venda particular atravessando entrada, tratamento de exceções, fila com antecedência, produção e postagem; conferir as bobinas nas três máquinas antes/depois do consumo; e abrir uma compra agrupada sem repetir material já comprado. Medir digitação, cliques, atrasos, recompra e diferença de inventário.

Migrações, funções e contas externas ainda precisam de aplicação/ativação e aceite real. Testes locais não provam uso real nem concorrência no PostgreSQL operacional. Nenhuma mensagem ou comando de alteração foi enviado ao Lovable.

## Verificação da revisão

- TypeScript e build de produção aprovados.
- 754 testes Vitest aprovados em 70 arquivos. A execução simultânea com banco/build teve dois timeouts de 5 segundos; a suíte completa isolada passou sem alterar os casos ou seus limites.
- 163 contratos operacionais e 54 cenários PostgreSQL aprovados em banco local isolado. Incluem revisão de ETA, isolamento por empresa/papel, repetição após falha, baixa única e confiança da bobina.
- Navegação Chromium em 1440px e 390px aprovada: Hoje, prazo particular com antecedência, bobinas/pesagem, reposição, ML/Shopee, repasses e simulação, sem gravações e sem erros de execução. Respostas interceptadas são fixtures; não constituem prova de conta integrada ou piloto real.
- Revisão independente: Standards sem achados; Spec com dois achados confirmados, ambos corrigidos e sem achados abertos no patch. Isso não encerra os critérios de aceite operacional acima.
