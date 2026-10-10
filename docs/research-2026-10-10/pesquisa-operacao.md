# Operação de uma farm FDM e modelo de domínio recomendado para o Forge Flow

Pesquisa realizada em 10/10/2026. Recorte: produção comercial com impressoras FDM/FFF, peças, placas, filamento e fluxo físico da farm. Este documento complementa o diagnóstico do repositório e da conversa com Gleyce; não presume que qualquer recurso aqui recomendado já existe no Forge Flow.

**Conclusão de domínio:** pedido comercial, produto montado, peça, receita de placa e execução de impressão precisam ser entidades diferentes. Uma placa pode produzir peças de vários produtos e pedidos. Um produto pode depender de várias placas, compras e montagem. O ERP deve organizar esses vínculos sem exigir que a operadora os recrie a cada venda.

## 1. Como a evidência foi obtida

Foram consultadas documentação oficial de fabricantes/fatiadores, código e documentação pública de projetos, documentação de fornecedores de software, entrevista com operador de farm, canal de experiência prática e materiais brasileiros. Não houve acesso a grupos privados, entrevistas novas, observação presencial, instalação de softwares, teste de impressoras ou teste de APIs. Nenhuma implementação de telemetria foi validada na farm do usuário.

As marcações deste relatório significam:

- **Fato documentado:** a fonte primária descreve aquele comportamento. Continua sujeito a versão, plano e modelo de impressora.
- **Declaração comercial:** o fornecedor anuncia o recurso; não foi medida sua confiabilidade.
- **Evidência anedótica:** relato de um operador/usuário, útil para descobrir problemas e práticas, sem representatividade estatística.
- **Proposta para o Forge Flow:** recomendação de desenho e operação derivada da análise. Não é um recurso comprovado do sistema atual nem requisito universal do setor.

Há uma limitação de acesso relevante: a página oficial da Bambu sobre redução de desperdício de troca de filamento (`https://wiki.bambulab.com/en/software/bambu-studio/reduce-wasting-during-filament-change`) retornou erro 402 nesta pesquisa. Para esse ponto, a evidência utilizada foi o README/código oficial do Bambu Studio e o artigo técnico oficial do AMS. A página bloqueada não foi usada como prova de detalhes que não puderam ser lidos.

## 2. O que os sistemas existentes comprovam

### 2.1 Placas e peças são estruturas de produção, não produtos comerciais

**Fato documentado.** O Bambu Studio oferece múltiplas placas, configuração por objeto/parte e vista de montagem. O PrusaSlicer oferece múltiplas placas desde a versão 2.9.0; a documentação consultada descreve até nove, estatísticas por placa e exportação conjunta dos G-codes. Na mesma página, todas as placas compartilham a configuração do projeto. Isso não torna um projeto uma ficha comercial ou garante que toda combinação de máquinas/perfis possa viver no mesmo arquivo. [Bambu Studio](https://github.com/bambulab/BambuStudio), [Multiple build plates on PrusaSlicer](https://help.prusa3d.com/article/multiple-build-plates-on-prusaslicer_823894).

**Proposta.** A ficha do produto deve registrar a composição de peças e operações. As placas são receitas reutilizáveis de produção dessa composição. Alterar o encaixe das peças na mesa ou dividir uma impressão em duas placas não deve criar outro SKU comercial.

### 2.2 3MF guarda mais contexto que STL, mas não é um contrato universal de ERP

**Fato documentado.** A Prusa descreve seu projeto 3MF como arquivo que reúne objetos, parâmetros, modificadores e outros dados de trabalho; STL guarda geometria. O 3MF Consortium publica especificação central e extensões; a extensão de produção trata identificação de partes. O código oficial do Bambu Studio mostra arquivos adicionais próprios, incluindo `Metadata/slice_info.config`, e campos de filamento como `used_m`, `used_g`, `used_for_support` e `used_for_object`. [Saving projects as 3MF](https://help.prusa3d.com/article/saving-projects-as-3mf_1773), [Specification — 3MF Consortium](https://3mf.io/spec/), [Código bbs_3mf.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp).

**Inferência.** Conseguir abrir um ZIP/3MF não significa conseguir extrair de qualquer arquivo tempo, custo, consumo por peça ou vínculos comerciais. Um projeto sem fatiamento pode não ter estatísticas finais. Um pacote de G-code pode ter dados diferentes do projeto editável. A importação deve identificar origem, versão e presença dos campos, mostrar o que conseguiu ler e permitir complemento manual apenas do que falta.

### 2.3 Falha parcial existe e precisa produzir saldo parcial

**Fato documentado.** A Prusa documenta cancelamento de um objeto durante uma impressão enquanto outros continuam, com requisitos de fatiador e firmware. A própria página contém relatos de usuários com resultados diferentes, inclusive dificuldades com muitas instâncias. O recurso descrito não é garantia de cancelamento em todo equipamento ou de inspeção automática da qualidade. [Cancel Object](https://help.prusa3d.com/article/cancel-object-mk4-s-mk3-9-s-xl-core-one-gen-2-mini_648856).

**Proposta.** O ERP precisa registrar quantidade boa, retrabalho e refugo por tipo de peça/instância, mesmo que o job tenha chegado a 100% na máquina. Reimprimir só o faltante quando houver receita compatível. Consumo e horas da tentativa continuam registrados; marcar falha não devolve o material à bobina.

### 2.4 Baixa automática de estoque frequentemente é uma estimativa

**Fato documentado.** A documentação do SimplyPrint explica que a baixa deriva do G-code e da conversão de comprimento em massa usando diâmetro e densidade. O registro da bobina é atualizado ao terminar. Cancelamento em 50% usa 50% do consumo previsto, inclusive para todos os extrusores em impressão multimaterial. Impressões iniciadas fora do serviço têm informações limitadas e não recebem baixa automática pela análise do arquivo. A documentação também reconhece extrusão extra de firmware e limites de captura de purga/troca manual. [How does SimplyPrint track filament usage?](https://help.simplyprint.io/en/article/how-does-simplyprint-track-filament-usage-1rdwu3f/).

**Proposta.** O Forge Flow deve mostrar origem da quantidade: previsto pelo fatiador, calculado de G-code, informado pela impressora, confirmado por pesagem ou ajustado manualmente. A interface nunca deve chamar tudo isso de peso real. A baixa automática pode reduzir trabalho mesmo sendo estimada, desde que a conciliação de bobinas seja simples e a origem fique visível.

### 2.5 Material disponível e máquina ociosa não bastam para iniciar uma placa

**Fato documentado.** A lista de tarefas do SimplyPrint explicita trocas de filamento, bico, tipo de mesa e reposição como bloqueios da fila. O 3DPrinterOS apresenta um estado de mesa livre. O relato de Zac Hartley descreve retirada das peças e liberação das máquinas pelos operadores antes de nova redistribuição. [Print queue to-do list](https://simplyprint.io/features/print-queue/to-do-list), [3D Printer Management in 3DPrinterOS](https://intercom.help/3DPrinterOS/en/articles/9712745-3d-printer-management-in-3dprinteros), [Entrevista com Zac Hartley](https://blog.prusa3d.com/interview-with-zac-hartley_118000/).

**Proposta.** A fila precisa mostrar o próximo trabalho executável e o que o impede. “Máquina terminou” e “máquina pronta” são estados diferentes; remoção, limpeza, resfriamento, bobina certa e presença do operador fazem parte da capacidade.

## 3. Modelo de domínio recomendado

Todas as recomendações desta seção são propostas para o Forge Flow. A nomenclatura visível deve usar palavras familiares à equipe; a estrutura completa pode existir sem aparecer como vários formulários.

| Conceito | O que representa | Dados mínimos e regra principal |
| --- | --- | --- |
| Produto e variante | O que o cliente compra | SKU interno, nome, variante, acabamento e unidade comercial. Cor/material que alteram a promessa comercial pertencem à variante. |
| Composição versionada | O necessário para formar uma unidade vendável | Peças e quantidades, itens comprados, operações de montagem e embalagem padrão; guardar versão utilizada na venda/produção. |
| Peça ou componente | Unidade física produzida e reaproveitável | Identificador, variante/material/cor, revisão do desenho, estoque bom e local. Uma peça pode atender mais de um produto. |
| Projeto e arquivos | Artefatos de engenharia e preparação | Arquivo original, origem, versão, checksum, perfil, licenciamento comercial quando relevante, vínculo à peça/receita. |
| Receita de placa | Como produzir determinado conjunto de peças | Composição da mesa, multiplicidade por peça, perfil de impressora/bico/mesa, filamentos requeridos, tempo e consumo previstos; foto/preview. |
| Execução de placa | Uma tentativa física em uma máquina | Receita/arquivo congelados, impressora, bobinas/slots, início/fim, operador, estado, consumo, resultados por peça e motivo de ocorrência. Repetir arquivo gera execução nova. |
| Lote de peças em processo | Saída aguardando inspeção/montagem | Origem da impressão, quantidades pendentes/boas/reprovadas, local e reserva. Não aumenta estoque vendável antes do ponto de qualidade definido. |
| Alocação | Destino comercial ou produtivo das peças | Quantidade da peça/execução/lote vinculada ao item do pedido ou reposição de estoque. Relação muitos-para-muitos, sem saldo negativo. |
| Pedido e item do pedido | Compromisso comercial | Canal, identificadores externos, SKU mapeado, quantidade, prazo de postagem, reserva e pendências. Vários itens do mesmo pedido podem ter fluxos diferentes. |
| Kit/montagem | Transformação de componentes em produto pronto | Baixa dos componentes e itens comprados, operação, responsável, saída boa e perda de montagem. |
| Material | Tipo de insumo | Polímero, fabricante, linha/acabamento, cor, diâmetro, densidade e compatibilidade. “PLA branco” não basta para toda substituição. |
| Bobina física | Unidade rastreável de filamento | ID curto/QR, material, lote, fornecedor/custo, tara, peso/estimativa, local, situação e histórico. Refill reutiliza suporte, mas cria entrada de material rastreável. |
| Movimento de material | Evento que explica o saldo | Compra, consumo, teste, purga, ajuste, perda, devolução/transferência; unidade e origem do dado. Uma transferência não consome material. |
| Impressora e configuração atual | Recurso produtivo e setup | Modelo, capacidade, bico, tipo de mesa, enclosure, material/slots, estado, manutenção e calendário. Setup atual não é capacidade permanente. |
| Operação manual | Trabalho fora do tempo de impressão | Preparação, troca, retirada, inspeção, acabamento, montagem e embalagem; pode ter checklist curto e tempo padrão. |

### Exemplo concreto: produto em várias placas e placa com mix

Exemplo hipotético, apenas para demonstrar o modelo. Uma luminária vendida precisa de uma base branca, uma cúpula azul, dois encaixes pretos, um módulo LED comprado, dois parafusos, montagem e uma caixa. A receita A produz quatro bases e dois suportes de outro produto; B produz quatro cúpulas; C produz oito encaixes. Essas três placas podem rodar em máquinas diferentes ou em momentos diferentes.

Para um pedido de três luminárias, a necessidade inicial é três bases, três cúpulas e seis encaixes, além dos comprados. Se já existe uma base boa e dois encaixes livres, a necessidade nova cai para duas bases, três cúpulas e quatro encaixes. Uma receita de placa cheia pode criar excedente útil para estoque; o ERP registra esse destino explicitamente.

Se A entregar três bases boas e uma base reprovada, há três unidades físicas disponíveis, independentemente de a máquina informar conclusão. Os suportes do outro produto têm resultados e destinos próprios. Se B entregar quatro cúpulas boas e C entregar somente quatro encaixes bons, há componentes para duas luminárias, apesar de sobrar cúpula. O gargalo é o encaixe.

O número de produtos completos montáveis, quando todos os componentes forem exclusivos desse cálculo, é:

`mínimo, entre os componentes, de piso(quantidade boa livre do componente / quantidade exigida por produto)`.

Componentes compartilhados entre produtos exigem alocação conjunta; somar esse resultado independentemente para cada SKU superestima a disponibilidade. O mesmo cuidado vale para compartilhar o estoque anunciado entre Mercado Livre e Shopee.

### Regras que evitam os erros mais caros

1. **Pedido não equivale a job.** Um pedido pode usar várias execuções e uma execução pode servir a vários pedidos.
2. **Job concluído não equivale a produto pronto.** Ainda podem faltar inspeção, outro componente, montagem ou embalagem.
3. **Estoque de componente e estoque de produto acabado não podem conter o mesmo material simultaneamente.** Montagem é transformação de saldos.
4. **Saldo total de filamento não equivale a material utilizável agora.** Bobina molhada, reservada, em uso, desconhecida ou incompatível não entra automaticamente como pronta.
5. **Alterar receita não altera o histórico.** Execução conserva arquivo, perfil e composição utilizados naquela tentativa.
6. **Desfazer uma confirmação corrige movimentos vinculados.** Não executar outra baixa/entrada às cegas; manter rastreabilidade e impedir duplicação de eventos.
7. **Cancelamento comercial e parada física são independentes.** Uma venda cancelada pode deixar peças úteis para outros pedidos ou estoque; impressão em curso consome material mesmo com cancelamento da venda.

## 4. Placas, importação e fatiamento sem criar mais burocracia

### Cadastro assistido pelo arquivo

**Proposta.** Arrastar o 3MF/G-code para o sistema deve preencher apenas os dados realmente presentes e apresentar uma revisão curta: placas detectadas, preview, tempo previsto, gramas por material/cor e máquina/perfil. O usuário associa os objetos/saídas aos componentes uma vez; nas próximas importações ou vendas, o sistema sugere o mapeamento já aprovado.

Nome de objeto no fatiador não é identidade confiável de SKU: nomes podem repetir, ser genéricos ou mudar ao exportar. Quantidade de “objetos” também pode incluir montagem, partes, modificadores, suportes e instâncias. O sistema precisa de identificação persistente ou de mapeamento confirmado, com multiplicidade por peça. Se o arquivo não permite isso, receita manual rápida continua válida.

O OrcaSlicer documenta estatísticas de fatiamento e placeholders, incluindo duração, filamento, peso, custo e trocas; a documentação diferencia disponibilidade conforme contexto do placeholder. Importar estatística existente é uma oportunidade, mas não prova que todo arquivo exporta todos esses campos. [Built-in placeholder variables](https://github.com/OrcaSlicer/OrcaSlicer/wiki/built_in_placeholders_variables).

### Versão da receita e compatibilidade

**Proposta.** Manter o projeto editável, o arquivo imprimível e a receita aprovados relacionados. Uma receita para bico de 0,4 mm não vira compatível com bico de 0,6 mm porque a geometria cabe na mesa. Compatibilidade deve considerar família/perfil da máquina, firmware/formato, volume, temperatura, material, nozzle e tipo de superfície, além de slots necessários.

Não construir um fatiador próprio na primeira atualização. Importar Bambu Studio/OrcaSlicer/PrusaSlicer e deixar o preparo técnico no ambiente conhecido pela equipe reduz aprendizagem. Fatiamento em lote/headless pode ser etapa posterior, com perfis fixados e arquivos de exemplo reais para validar o resultado.

### Placa cheia, urgência e peça faltante

**Proposta.** A operação deve poder escolher entre receita econômica de placa cheia, receita rápida de reposição e execução parcial aprovada. O sistema informa excedente, horas e custo esperado; não exige placa cheia se isso comprometer o prazo de postagem.

Placa com mais peças pode diluir setup, torre e trocas, mas pode ampliar a perda correlacionada de uma falha e estender a espera do pedido. Otimizar somente ocupação da mesa, gramas ou duração ignora a conclusão do kit e o compromisso de expedição. Comparar o resultado com a receita da mesma variante e mesma máquina, sem supor economia universal.

## 5. Estoque de filamento: catálogo agregado e bobina física

### Duas visões, um só saldo

**Proposta.** A equipe compra e consulta estoque agregado por material/marca/cor; imprime a partir de bobinas físicas. Mostrar “PLA branco: 3,7 kg totais; 3,3 kg liberados, dos quais 0,9 kg reservados; 2,4 kg livres; 0,4 kg em secagem”, com consulta opcional por bobina. Reserva é uma alocação, não outra quantidade física para somar ao estoque. A tela diária não deve obrigar a abrir vinte cadastros para responder se falta branco.

O Spoolman demonstra a utilidade de registrar materiais/fabricantes e bobinas individuais, localização, QR, API e integração de consumo com OctoPrint/Klipper/Moonraker. Isso é boa referência para rastreabilidade; não prova integração pronta com toda Bambu/AMS. [Spoolman](https://github.com/Donkie/Spoolman).

### Local e AMS

**Proposta.** Usar hierarquia simples: estoque → estante/caixa; farm → impressora → AMS → slot; secador; quarentena. Carregar uma bobina é transferir sua localização e atribuir o slot. A produção utiliza a bobina real atribuída, permitindo troca durante o job. Mesmo material pode estar em várias bobinas; um ID de perfil do fatiador não é ID da bobina.

O SimplyPrint documenta atribuição por slot de AMS/multi-extrusor, etiqueta e local. Sua documentação de auto-refill esclarece que a decisão de trocar bobina pertence ao firmware, enquanto o serviço observa a troca e faz cálculo proporcional pelo progresso. [The Filament Manager feature](https://help.simplyprint.io/en/article/the-filament-manager-feature-track-organize-and-manage-your-filament-inventory-bpy529/), [AMS auto-refill and filament tracking](https://help.simplyprint.io/en/article/ams-auto-refill-and-filament-tracking-in-simplyprint-3epst3/).

**Inferência/proposta.** O ERP não deve prometer que duas bobinas com a mesma cor serão automaticamente somadas pela impressora. Essa disponibilidade depende do equipamento, configuração de backup, material, slots e confirmação de compatibilidade. Uma placa que consome 700 g não está liberada só porque existem duas bobinas de 400 g no almoxarifado. Exibir “precisa carregar bobina suficiente ou configurar troca” é uma ação operacional útil.

### Peso, tara e conciliação

**Proposta.** Campo “peso total na balança” deve subtrair a tara do carretel e suportes utilizados. Ao receber filamento, distinguir peso nominal do material, tara e medição. Ao pesar uma bobina, gerar ajuste de conciliação com motivo; não apagar as baixas anteriores. Um saldo negativo ou salto inesperado pede correção operacional, sem esconder a inconsistência.

Guardar data da última pesagem e do último ajuste. Priorizar conciliação de bobinas abertas, saldos perto do mínimo e materiais caros; pesagem antes/depois de cada impressão pode recriar a burocracia que o usuário quer remover. Testes de calibração e purgas fora das vendas precisam ter baixa rápida de material sem cadastro de pedido fictício.

### Secagem e reserva

**Fato documentado.** A Prusa descreve materiais higroscópicos, diferenças entre polímeros, armazenamento com dessecante e tempos/temperaturas específicos de seus materiais e versões de carretel. O artigo técnico do AMS de 2022 descreve o AMS original com armazenamento fechado/dessecante e sem secador ativo; esse artigo não deve ser generalizado aos AMS 2 Pro/HT. Páginas oficiais desses modelos anunciam módulos de secagem e condições específicas de uso. [Drying filament](https://help.prusa3d.com/article/drying-filament_332086), [Bambu Lab AMS explained in detail](https://blog.bambulab.com/ams/), [AMS 2 Pro — loja oficial](https://us.store.bambulab.com/products/ams-2-pro?from=home_web), [AMS HT — loja oficial](https://asia.store.bambulab.com/collections/bambu-lab-ams/products/ams-ht).

**Proposta.** Registrar condição da embalagem (“lacrada”/“aberta”) separadamente da situação operacional (“em secagem”/“liberada”/“quarentena”), com regras por material apenas quando a operação exigir. Última secagem, data de abertura e ciclo de secagem são informação da bobina; não impor validade inventada igual para PLA e nylon. Temperatura do ar/umidade do AMS não mede diretamente teor de água no polímero.

Reserva de material é demanda planejada; consumo é movimento físico. Liberar reserva após cancelamento não devolve material já extrudado. A reserva deve bloquear reutilização indevida, mas permitir remanejamento claro pelo operador.

## 6. Estimado, executado e custo: três coisas diferentes

### Consumo material

**Proposta.** Tratar gramas por material/cor, não apenas peso total da placa. Distinguir quando houver dado confiável: peça, suporte, brim/raft, torre, purga/troca e preparação. Quando o fornecedor só retorna total, guardar total e marcar categorias não disponíveis; não inventar divisão.

Na impressão multicolor de um único hotend, trocas têm custo de tempo e material; aproveitar purga no infill/objeto pode mudar o destino físico do material. Peso do produto acabado não captura todo consumo da bobina, e “purga” não deve ser somada novamente se já estiver incluída no total extraído do arquivo. O Bambu Studio documenta destinar filamento de transição ao infill/objeto. [Bambu Studio — funcionalidades](https://github.com/bambulab/BambuStudio).

Fallback por percentual de progresso deve ficar rotulado como aproximação. Consumo por camada/material não precisa ser uniforme: uma cor pode ser utilizada apenas no começo ou no fim; 50% do tempo não equivale necessariamente a 50% dos gramas de cada cor. Preferir extrusão realmente reportada/percorrida quando houver integração comprovada, e pesagem como reconciliação. Não inferir consumo confiável de “impressora online” ou “sensor detectou filamento”.

### Tempo

**Fato documentado.** A Prusa explica que estimativa de duração depende do perfil correto e de parâmetros da máquina, como aceleração. Isso não inclui necessariamente todo o ciclo físico e trabalho humano. [FAQ — PrusaSlicer](https://help.prusa3d.com/article/faq-prusaslicer_1789).

**Proposta.** Guardar tempo previsto do arquivo; tempo real de impressão; ocupação total da máquina; tempo de operador. Exemplos de períodos diferentes: pré-aquecimento/calibração, execução, pausa, resfriamento, espera de retirada e manutenção. A correção de estimativa deve usar histórico por receita/família/configuração, com amostra suficiente, e exibir intervalo quando há incerteza.

### Custo e apropriação da placa mista

**Proposta.** O custo de produção inclui o material de todas as tentativas, energia e uso/desgaste da máquina conforme política de custo, tempo de operador, consumíveis e acabamento/montagem. Frete subsidiado, embalagem e taxas comerciais pertencem à economia da venda/pedido; embalagem também tem estoque físico. O custo do LED/parafuso comprado entra na composição, sem fingir que é filamento.

O exemplo de precificação da Prusa inclui trabalho, equipamento e reserva para falhas, além do material. Os valores e hipóteses de um exemplo estrangeiro de 2020 não servem como tarifa local de energia, remuneração ou probabilidade de falha. [How to calculate 3D printing costs?](https://blog.prusa3d.com/how-to-calculate-printing-costs_38650/).

Em placa mista, separar material atribuível à peça dos custos compartilhados. Uma regra inicial explícita pode distribuir setup/ciclo/purga comum por peso previsto ou por tempo isolado estimado das peças; nenhum desses critérios é verdade física universal. Guardar a política e os pesos usados. Ratear a placa inteira uma vez por produto que esteve nela duplica custo. Dividir por todas as peças planejadas mesmo após refugos subestima custo da saída boa.

Para análise gerencial, custo por unidade boa do lote pode ser `custos atribuídos às tentativas e ao acabamento / quantidade boa obtida`, dentro da política definida. Falha entra no lote/produto que a causou quando rastreável; custo de investigação/calibração pode ser custo da farm. Não aplicar um percentual de perda em cima de um custo histórico que já inclui as mesmas perdas. Preço cadastrado, custo previsto e margem efetivamente realizada devem permanecer separados.

## 7. Fila, capacidade e manutenção

### A fila diária deve ser uma lista de decisões

**Proposta.** Mostrar primeiro pedidos que precisam sair, kits incompletos, trabalhos executáveis e ações que liberam a produção. Exemplos: “faltam quatro encaixes do pedido 123”; “trocar a P2 para PLA preto libera a placa”; “retirar peças da P4”; “aguardando LED comprado”. Filtros por material e impressora apoiam a execução, mas a prioridade comercial deve continuar visível.

Prazo principal é o limite de postagem, com reserva de tempo para inspeção, montagem e embalagem. Agrupar por cor/material economiza setup, mas precisa respeitar urgência e kit completo. Produção para estoque deve aproveitar capacidade ociosa com limite de cobertura, evitando consumo do filamento reservado para pedidos pagos.

Uma impressão noturna de seis horas numa máquina que não terá operador para retirada por mais seis ocupa a janela inteira até a liberação. Portanto, “número de impressoras × 24 horas” não é capacidade vendável. O SimplyPrint anuncia planejamento por horários em que a farm está atendida; esse é um bom princípio de comparação, sem adotar suas promessas comerciais de ganho como resultado esperado do Forge Flow. [Print queue](https://simplyprint.io/features/print-queue).

### Configuração e calendários

**Proposta.** A compatibilidade e a disponibilidade precisam distinguir:

- Máquina habilitada para o produto versus setup atualmente carregado.
- Impressora disponível versus mesa ocupada/suja/em resfriamento.
- Material comprado versus recebido, liberado, seco e carregado.
- Horas possíveis versus turnos com retirada/troca/inspeção disponíveis.
- Capacidade de impressão versus capacidade de acabamento/montagem/expedição.

Evitar algoritmo complexo no início: prioridade por prazo, elegibilidade clara e sugestão de agrupamento por material já resolvem muitos erros. Mostrar a razão de escolha e permitir alteração com histórico. Refinar com tempos reais e causas de ociosidade quando houver dados.

### Manutenção

**Proposta.** Registrar bloqueio de manutenção, próximo serviço, horas desde serviço, falhas e peças substituídas. Rotinas por calendário, horas, volume extrudado ou ocorrência devem seguir as recomendações do modelo/fabricante e o histórico observado; não usar intervalo único para toda a farm. Impressora em manutenção não entra na capacidade.

A documentação do SimplyPrint distingue regras de manutenção, serviço criado e tarefas executadas, com gatilhos de dias, horas, consumo, número de impressões e falhas. A entrevista de Zac mostra dois níveis de cuidados na operação dele. Esses são padrões úteis; não são instruções para lubrificar componentes de qualquer outra marca do mesmo jeito. [Maintenance schedules](https://help.simplyprint.io/en/article/maintenance-schedules-automate-recurring-maintenance-i4of7u/), [Zac Hartley](https://blog.prusa3d.com/interview-with-zac-hartley_118000/).

Peças de reposição, bicos, correias, mesas e consumíveis pertencem às compras/estoque. Uma peça barata ausente pode travar capacidade; a sugestão de compra deve poder considerar criticidade e prazo do fornecedor, além de consumo médio.

## 8. O que integrar e o que validar antes de prometer

| Referência | Papel comprovado/documentado | O que o Forge Flow pode aprender | Limite da evidência |
| --- | --- | --- | --- |
| Bambu Studio | Fatiamento, projeto com várias placas, parâmetros por objeto/parte e monitoramento | Importar contexto em vez de pedir peso/tempo repetidos; versionar receita | Plugin de rede tem componentes não livres. README não prova API de ERP nem compatibilidade universal de telemetria. |
| PrusaSlicer + Prusa Connect | Projetos, múltiplas placas, G-code e gestão remota/fila/histórico por impressora | Biblioteca de receitas e histórico de execução | Connect publica lista de máquinas suportadas. Fila de máquina não resolve por si a composição comercial/montagem do ERP. |
| OrcaSlicer | Estatísticas e configuração de material documentadas no projeto oficial | Extrair previsão e preservar perfil/densidade/preço | Placeholders dependem do contexto; custo do fatiador é estatístico, não contabilidade da venda. |
| Spoolman | Bobinas, materiais/fabricantes, localização, QR, API e integrações citadas | Identidade da bobina, eventos e estoque agregado | O peso atualizado por integração não é prova de balança. Integrar com API não prova rastrear AMS corretamente. |
| OctoFarm | Agrega instâncias de OctoPrint por API/WebSocket, dados, arquivos, filamento e histórico | Uma visão da farm e adaptador desacoplado | Dependência de OctoPrint/plugin e estado real de manutenção do projeto devem ser avaliados; não é ERP marketplace. |
| SimplyPrint | Documentação detalhada de fila, placas, compatibilidade, bobinas, API e manutenção | Lista de bloqueios, agrupamento, campos rápidos e camada operacional | Planos e modelos importam. Número do pedido é campo personalizado; dedução material muitas vezes é estimativa. |
| 3DPrinterOS | Documentação de fila/máquina e API para arquivos, jobs, estados e comandos | Conector operacional e confirmação de mesa livre | Algumas rotas da API aparecem “in development”; logs têm suporte restrito. Não assumir tudo disponível em todo modelo. |
| AutoFarm3D/3DQue | Fornecedor anuncia jobs por ordem, matching e retirada automática com VAAPR | Separar ordem/execução e condição física da retirada | Página consultada é comercial e menciona early access para algumas Bambu; validar suporte atual. Retirada automática depende de solução física/arquivo adequados. |

Fontes diretas da tabela: [Bambu Studio](https://github.com/bambulab/BambuStudio), [Prusa Connect](https://connect.prusa3d.com/), [Orca — material basic information](https://github.com/OrcaSlicer/OrcaSlicer/wiki/material_basic_information), [Spoolman](https://github.com/Donkie/Spoolman), [OctoFarm](https://github.com/OctoFarm/OctoFarm), [SimplyPrint — adicionar fila](https://help.simplyprint.io/en/article/adding-items-to-the-print-queue-files-plates-custom-fields-and-the-api-5aht3p/), [3DPrinterOS API v2.1](https://intercom.help/3DPrinterOS/en/articles/13516944-3dprinteros-global-api-calls-v2-1), [AutoFarm3D Order Management](https://www.3dque.com/order-management-landing-page).

**Proposta de sequência de integração:** começar com importação de arquivos e apontamento rápido; adicionar consulta de estado de poucas máquinas piloto; comparar execução, falhas, consumo e trocas com o que ocorreu fisicamente; então automatizar comandos e baixas para os modelos validados. A farm deve continuar registrando trabalho quando o conector estiver indisponível.

Eventos repetidos e atrasados são problemas de estoque, não só de infraestrutura. Uma integração precisa impedir dupla baixa, detectar execução iniciada fora do ERP, reconciliar trocas de bobina e distinguir “comando enviado” de “impressão iniciada”. IA de falha, liberação automática de mesa e eject automático são recursos separados; alerta/câmera não prova peça boa, mesa vazia ou kit completo.

## 9. Experiência prática e contexto brasileiro

### Exterior: entrevista com Zac Hartley — evidência anedótica

[How to build a 3D printing farm for business — interview with Zac Hartley](https://blog.prusa3d.com/interview-with-zac-hartley_118000/) é entrevista publicada pelo fabricante com operador que relata 70 Prusa, duas pessoas na operação, PETG preto, bicos de 0,8 mm e grandes rolos. O relato descreve retirada humana e redistribuição central; eject automático estava em desenvolvimento naquele momento. Ele enfatiza fluxo do material até embalagem e expedição.

Isso sustenta a utilidade prática de padronização e liberação simples da máquina. Não comprova retorno financeiro nem operação sem pessoas. Uma farm monocor com poucos setups é diferente da farm multicolor descrita pelo usuário; copiar sua capacidade ou custo energético seria extrapolação indevida.

### Canal prático: Crosslink — evidência anedótica

[$12,000 3D Printing Project: Failures, Learnings & My Print Farm Tour!](https://www.crosslink.io/2024/05/17/12000-3d-printing-project-failures-learnings-my-print-farm-tour/) é publicação de Daniel/Crosslink que apresenta seu projeto, problemas, preço e aprendizado, e vincula vídeo de montagem de gabinete e planilha de orçamento. Foi lida a página textual; o vídeo completo e a planilha não foram auditados. O valor de US$ 12 mil do título não foi validado como receita líquida ou lucro.

É um canal útil para observação adicional de montagem de produto composto. Nenhuma recomendação técnica deste relatório depende de números não vistos no vídeo.

### Brasil: padronização e produtos comerciais

[Como montar uma farm de impressão 3D: guia prático — 3D Control](https://3dcontrol.com.br/blog/como-montar-uma-farm-de-impressao-3d/) descreve fila compartilhada com trabalhos compatíveis, arquivos claros, padronização de máquina/filamento, cor/acabamento afetados por troca de marca e histórico de manutenção. É publicação de fornecedor de software: serve como evidência do enfoque operacional e de mercado, não como medição independente de resultado nem confirmação das integrações anunciadas.

[Fazenda de impressão 3D: o que é e como funciona — Filamentos 3D Brasil](https://www.filamentos3dbrasil.com.br/blog/posts/fazenda-de-impressao-3d-d018a93ac723) destaca fluxo de produção, qualidade, armazenamento, operação/embalagem e custos que ultrapassam filamento. É texto de fornecedor de material com finalidade comercial. Afirmações amplas sobre nichos mais lucrativos, escala e IA não foram tomadas como fatos demonstrados.

**Orientação proposta para a farm:** reduzir variedade de marcas/perfis onde houver equivalência aprovada; manter teste de peça padrão por combinação material/máquina; guardar lotes compatíveis para produtos de aparência sensível; organizar retirada → inspeção → montagem → embalagem em fluxo visível. Padronizar parte da operação libera atenção para exceções rentáveis sem eliminar variantes que realmente vendem.

## 10. Prioridades para reduzir burocracia e aumentar uso

1. **Uma ficha inicial por produto que gera trabalho automaticamente.** Produto vendido explode composição, aproveita estoque bom e gera necessidade de componentes. Não recadastrar etapas por pedido.
2. **Uma fila operacional única com prazo e bloqueios.** Um pedido incompleto mostra o que falta; uma máquina livre mostra o próximo trabalho compatível.
3. **Baixa de filamento a partir da execução.** Preenchimento sugerido pelo arquivo/bobina, confirmação rápida e conciliação. Separar reserva de consumo.
4. **Encerramento de placa com exceção rápida.** Padrão “tudo bom”; opção “alterar quantidades”/“falhou” com motivos curtos e reposição do faltante. Registro simples o bastante para ocorrer toda vez.
5. **Montagem e produto pronto em um gesto claro.** Confirmar o kit consome os componentes e os comprados, cria unidade final e mantém vínculo ao pedido.
6. **Compras a partir de necessidade líquida.** Filamento por material compatível, componentes comprados, embalagens e peças críticas; descontar estoque utilizável e compras confirmadas sem contar bobina reservada duas vezes.
7. **Telemetria depois do modelo correto.** Automatizar uma baixa no conceito errado torna o erro mais rápido. Piloto pequeno com reconciliação física antes de expansão.

Fluxo mínimo da operadora: pedidos recebidos/mapeados → “produzir faltantes” → carregar/atribuir bobina e iniciar placa → confirmar saída boa/exceção → montar/embalar → pronto para expedir. Os cadastros completos, custos e movimentos surgem desse fluxo, com detalhes acessíveis quando necessário.

### Critérios concretos de validação com a equipe

Propostas de casos de aceitação para a atualização, a serem exercitados com arquivos e pedidos reais:

- Um produto composto por três placas só fica pronto após componentes suficientes e montagem.
- Uma placa com peças de dois produtos alimenta seus saldos/destinos sem duplicar tempo ou custo.
- Uma falha parcial repõe apenas os faltantes e conserva consumo/horas da tentativa.
- Duas bobinas de mesma cor em slots diferentes recebem o consumo correto ou mostram explicitamente que a atribuição ainda é estimada.
- Uma impressão por SD/USB ou fora do ERP pode ser vinculada e apontada sem pedido fictício.
- Ajuste por pesagem altera saldo com histórico e não dispara segunda baixa do job.
- Máquina em manutenção ou mesa ocupada não é capacidade disponível.
- Cancelamento da venda libera reserva, mas não apaga consumo nem componentes bons já obtidos.
- Um pedido aproveita peças existentes e gera só necessidade líquida; componente compartilhado não é prometido para dois pedidos.
- Recebimento de filamento comprado cria saldo/bobina disponível e atualiza pendências sem exigir recadastro manual.

Métricas propostas: tempo humano para planejar/iniciar/encerrar job; pedidos completos no prazo; percentual de apontamentos feitos sem correção; divergência físico/sistema por bobina; horas bloqueadas por retirada/setup/manutenção; refugo por receita/máquina/material; margem por unidade boa; quantidade e causa de retrabalho administrativo. Medir antes/depois com Gleyce e outras pessoas; redução de cliques sozinha não comprova adoção.

## 11. Registro das fontes e limites

As URLs nas seções apontam diretamente para a fonte relevante. Lista de controle para futura revisão:

| Fonte | Natureza | O que foi confirmado | O que não foi confirmado |
| --- | --- | --- | --- |
| [Bambu Studio — README](https://github.com/bambulab/BambuStudio) | Projeto oficial | Múltiplas placas, objeto/parte, rede opcional, destinação de filamento de transição | API de ERP, integração com modelos da farm |
| [bbs_3mf.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp) | Código oficial | Metadados próprios de placa/filamento e arquivos auxiliares | Parsing validado em arquivos do usuário; estabilidade de schema por versão |
| [Saving projects as 3MF](https://help.prusa3d.com/article/saving-projects-as-3mf_1773) | Documentação oficial | Conteúdo de projeto e diferença para STL | Conteúdo obrigatório de qualquer 3MF |
| [Multiple build plates](https://help.prusa3d.com/article/multiple-build-plates-on-prusaslicer_823894) | Documentação oficial | Várias mesas, estatísticas/exportação por mesa e configuração comum no recorte descrito | Configurações distintas por mesa em toda versão futura |
| [3MF Specification](https://3mf.io/spec/) | Organização do padrão | Core e extensões de formato/produção | Semântica comercial SKU/pedido em arquivos da farm |
| [Cancel Object](https://help.prusa3d.com/article/cancel-object-mk4-s-mk3-9-s-xl-core-one-gen-2-mini_648856) | Documentação oficial + comentários | Recurso e requisitos de versão; falha parcial como situação tratada | Funcionamento universal ou aprovação automática de qualidade |
| [PrusaSlicer FAQ](https://help.prusa3d.com/article/faq-prusaslicer_1789) | Documentação oficial, página com conteúdo legado | Estimativa depende de perfil/parâmetros corretos | Precisão prometida em máquinas de terceiros; atualidade de todo item da FAQ |
| [Prusa Connect](https://connect.prusa3d.com/) | Página oficial | Fila/histórico por máquina, telemetria anunciada e máquinas listadas | API externa específica e BOM/montagem comercial |
| [Orca — material basic information](https://github.com/OrcaSlicer/OrcaSlicer/wiki/material_basic_information) | Wiki oficial | Densidade e preço de material para estatística | Custo total contábil/comercial |
| [Orca — placeholders](https://github.com/OrcaSlicer/OrcaSlicer/wiki/built_in_placeholders_variables) | Wiki oficial | Estatísticas e disponibilidade por contexto | Presença dos campos em todo arquivo importado |
| [Spoolman](https://github.com/Donkie/Spoolman) | Projeto oficial | Estrutura bobina/material/fabricante, API, QR/local e integrações citadas | Sensor de pesagem e rastreio nativo de toda AMS |
| [OctoFarm](https://github.com/OctoFarm/OctoFarm) | Projeto oficial | Agregação de OctoPrint, dados/arquivos/filamento/histórico | Adequação operacional/manutenção atual para produção crítica |
| [SimplyPrint — adicionar fila](https://help.simplyprint.io/en/article/adding-items-to-the-print-queue-files-plates-custom-fields-and-the-api-5aht3p/) | Documentação do fornecedor | Jobs por placa, tags/compatibilidade, pedido como custom field, API | Entidade pedido/BOM equivalente a ERP |
| [SimplyPrint — Filament Manager](https://help.simplyprint.io/en/article/the-filament-manager-feature-track-organize-and-manage-your-filament-inventory-bpy529/) | Documentação do fornecedor | Bobina individual, local/slot, etiqueta e tracking | Pesagem física automática universal |
| [SimplyPrint — tracking](https://help.simplyprint.io/en/article/how-does-simplyprint-track-filament-usage-1rdwu3f/) | Documentação do fornecedor | Estimativa G-code, baixa ao fim e limitações | Massa real de cada categoria/peça |
| [SimplyPrint — AMS auto-refill](https://help.simplyprint.io/en/article/ams-auto-refill-and-filament-tracking-in-simplyprint-3epst3/) | Documentação do fornecedor | Refill é decisão do firmware; tracking proporcional | Controlar refill pelo ERP; regras garantidas em todo firmware |
| [SimplyPrint — bloqueios](https://simplyprint.io/features/print-queue/to-do-list) | Página comercial do fornecedor | Tipos de ação que o produto anuncia | Ganho de produtividade medido independentemente |
| [SimplyPrint — queue](https://simplyprint.io/features/print-queue) | Página comercial do fornecedor | Compatibilidade e atendimento/turnos anunciados | Ganho financeiro/de capacidade para o usuário |
| [SimplyPrint — maintenance schedules](https://help.simplyprint.io/en/article/maintenance-schedules-automate-recurring-maintenance-i4of7u/) | Documentação do fornecedor | Tipos de regra e separação serviço/tarefas | Frequência correta para cada máquina da farm |
| [3DPrinterOS — Printer Management](https://intercom.help/3DPrinterOS/en/articles/9712745-3d-printer-management-in-3dprinteros) | Documentação do fornecedor | Mesa livre, jobs por máquina e restrições de logs | Mesma profundidade em todo modelo |
| [3DPrinterOS API v2.1](https://intercom.help/3DPrinterOS/en/articles/13516944-3dprinteros-global-api-calls-v2-1) | Documentação do fornecedor | Rotas descritas e marcações de desenvolvimento | Integração autenticada/testada com Forge Flow |
| [AutoFarm3D Order Management](https://www.3dque.com/order-management-landing-page) | Página comercial do fornecedor | Ordem/job, matching e eject com solução VAAPR anunciados | Suporte atual completo, eject com hardware padrão |
| [Drying filament](https://help.prusa3d.com/article/drying-filament_332086) | Documentação oficial | Higroscopia, armazenamento e recomendações por material/carretel | Receitas universais para qualquer marca/material |
| [Bambu AMS explained](https://blog.bambulab.com/ams/) | Artigo técnico oficial de 2022 | Arquitetura, RFID e armazenamento do AMS original | Recursos de toda geração AMS |
| [AMS 2 Pro](https://us.store.bambulab.com/products/ams-2-pro?from=home_web), [AMS HT](https://asia.store.bambulab.com/collections/bambu-lab-ams/products/ams-ht) | Lojas oficiais | Secagem anunciada em modelos específicos; primeira URL verificada pelo índice e com abertura direta bloqueada nesta sessão | API, disponibilidade na farm ou secagem simultânea em qualquer configuração |
| [Prusa — custos](https://blog.prusa3d.com/how-to-calculate-printing-costs_38650/) | Artigo oficial com exemplo hipotético | Categorias de custo e hipótese de falha | Preços/tarifas/taxas brasileiros atuais |
| [Zac Hartley — entrevista](https://blog.prusa3d.com/interview-with-zac-hartley_118000/) | Relato de operador em canal do fabricante | Rotina relatada, padronização e liberação humana | Generalização de resultados/finanças; estado da farm hoje |
| [Crosslink — projeto](https://www.crosslink.io/2024/05/17/12000-3d-printing-project-failures-learnings-my-print-farm-tour/) | Canal prático, relato pessoal | Existência de relato de projeto/montagem/orçamento | Conteúdo integral do vídeo e resultado financeiro auditado |
| [3D Control — farm](https://3dcontrol.com.br/blog/como-montar-uma-farm-de-impressao-3d/) | Fornecedor brasileiro de software | Ênfase em compatibilidade, padronização e rotina | Resultado independente ou integrações testadas |
| [Filamentos 3D Brasil — farm](https://www.filamentos3dbrasil.com.br/blog/posts/fazenda-de-impressao-3d-d018a93ac723) | Fornecedor brasileiro de material | Ênfase em fluxo, qualidade e custos além do material | Lucratividade dos nichos e eficácia de IA anunciadas |

Para decidir fornecedores ou integrações, confirmar versão, modelos e plano na data de contratação, usar arquivos reais da operação e medir reconciliação física. Esta pesquisa identifica princípios e referências; não substitui esse piloto.
