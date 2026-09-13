# Referências para o Forge & Flow — gestão de fazendas de impressão 3D

Consulta realizada em **13/09/2026**, com leitura das páginas oficiais indicadas ao longo do documento. O objetivo é comparar funções e orientar o desenvolvimento do Forge & Flow. Não há classificação de “melhor sistema”: escopo, hardware, plano contratado e forma de iniciar as impressões mudam o que cada produto consegue fazer. Não foram realizadas assinaturas, demonstrações autenticadas ou medições independentes de desempenho desses serviços.

**Estado da entrega Forge & Flow: implementação principal concluída localmente, com integração final em andamento. Publicação pendente de confirmação.** Histórico Bambu, apuração, fontes e múltiplas placas já têm código e testes locais. A revisão específica de rejeição de qualidade após a apuração está sendo integrada na migration `20260913033000_bambu_quality.sql`. O responsável pela entrega deve registrar a aplicação das migrations, a publicação e a validação no ambiente publicado; este documento não afirma que já aconteceram. O roteiro futuro abaixo exclui funções já entregues no código.

## O que as referências documentam

| Referência | Foco documentado | Uso como referência para o Forge & Flow |
| --- | --- | --- |
| SimplyPrint | Arquivo, histórico de impressão, filamento e operação das máquinas. | Identificar a origem dos dados e acompanhar cada bobina. |
| 3DPrinterOS | Preparação de arquivos, projetos e cobrança dos usuários da organização. | Preservar revisões do projeto e separar cálculo de cobrança de apuração do custo. |
| AutoFarm3D, da 3DQue | Fila central, distribuição entre impressoras e automação física. | Planejar capacidade, compatibilidade e coleta de peças. |

### SimplyPrint: consumo automático depende da origem da impressão

O SimplyPrint informa que analisa o G-code e converte o comprimento de extrusão em gramas usando diâmetro e densidade do filamento. A baixa acontece ao encerrar a impressão; em falhas ou cancelamentos, usa uma proporção baseada no progresso. A documentação reconhece diferenças possíveis por purga fora do arquivo e por interrupções. Impressões iniciadas pela tela da máquina, SD/USB ou outro serviço aparecem com origem externa e dados limitados, mas não provocam dedução automática das bobinas. Portanto, “automático” não equivale, por si só, a “pesado”. [Como o SimplyPrint acompanha o consumo](https://help.simplyprint.io/en/article/how-does-simplyprint-track-filament-usage-1rdwu3f/).

A análise do arquivo também procura perfil da impressora, bico, camadas, material e parâmetros do fatiador. Alguns valores são lidos dos comentários; a extrusão pode ser calculada percorrendo o arquivo quando falta a estimativa do fatiador. Isso oferece uma base para identificar **qual preparação foi produzida**, além do nome do modelo. [Análise de G-code](https://help.simplyprint.io/en/article/all-about-the-gcode-analysis-feature-1klftk6/).

O gerenciamento de filamento individualiza cada bobina: identificação, quantidade restante, custo de compra, localização, associação à máquina/slot, ajustes de peso e histórico. Há etiquetas QR e NFC, leitura pelo celular e informações de lote. O histórico de uma bobina permite seguir os trabalhos e ajustes que alteraram seu saldo. [Filament Manager](https://help.simplyprint.io/en/article/the-filament-manager-feature-track-organize-and-manage-your-filament-inventory-bpy529/).

O rastreamento de uma troca automática de bobina no AMS é descrito como observação da troca feita pelo firmware, com divisão proporcional pelo progresso. A plataforma não decide quando ocorrerá o auto-refill nem qual bobina de reserva o firmware escolherá. Isso reforça a necessidade de separar **observar a máquina** de **controlar a máquina**. [AMS auto-refill e rastreamento](https://help.simplyprint.io/en/article/ams-auto-refill-and-filament-tracking-in-simplyprint-3epst3/).

O histórico combina arquivo, máquina, usuário, duração prevista e registrada, material, custo e origem do registro. A documentação distingue impressões acompanhadas, lançamentos manuais e importações, além de oferecer filtros e detalhes por trabalho. Certas funções e limites dependem do plano. [Histórico de impressão](https://help.simplyprint.io/en/article/the-print-history-feature-your-searchable-log-of-every-print-job-bo3vwu/).

No lançamento manual, conclusão e qualidade são escolhas diferentes: uma impressão concluída pode receber avaliação ruim. Registrar o ocorrido não envia comandos à máquina. Essa separação é útil para o ERP porque uma peça terminada ainda pode ser rejeitada na inspeção. [Lançamento manual e qualidade](https://help.simplyprint.io/en/article/how-to-log-a-print-by-hand-in-your-print-history-p978f5/).

### 3DPrinterOS: versões de arquivo e regras de cobrança

A documentação organiza arquivos e projetos. Alterar e salvar um STL produz um novo arquivo; original e resultado ficam no projeto, tratado como histórico de versões. O G-code apresenta parâmetros como impressora, camada, material por extrusor e tempo estimado. O ponto relevante para o Forge & Flow é manter a ligação entre produto vendido, preparação escolhida e arquivo efetivamente usado, sem substituir silenciosamente o arquivo de uma produção passada. [Estrutura de arquivos e projetos](https://intercom.help/3DPrinterOS/en/articles/9703457-file-structure-in-3dprinteros).

A cobrança utiliza peso e duração **estimados pela análise do G-code**, combinados com tarifas de material, hora e uma parcela adicional descrita como depreciação. As configurações podem valer para a organização ou para perfis de fatiamento. Há alteração administrativa do valor com descrição e regras de cobrança/reembolso em reinícios, cópias e interrupções. Isso documenta um modelo de cobrança de uso; não comprova apuração contábil completa de uma fábrica. [Billing no 3DPrinterOS](https://intercom.help/3DPrinterOS/en/articles/9714779-billing-in-3dprinteros).

### AutoFarm3D: capacidade e fluxo físico

O AutoFarm3D documenta fila central com correspondência entre trabalhos e impressoras, redistribuição quando a situação muda e envio quando uma máquina compatível fica disponível. Tags e quantidades fazem parte da entrada na fila. O benefício relevante para o planejamento do ERP é enxergar o trabalho pendente e a capacidade utilizável, em vez de apenas listar impressoras. [Smart Queue](https://www.3dque.com/features/smart-queue).

A página oficial também descreve acompanhamento de pedidos, trabalhos prontos para coleta, histórico, organização de arquivos e versões, alertas e níveis de filamento. A remoção automática de peças depende de hardware adicional. Recursos comerciais anunciados não constituem prova de que qualquer impressora possa recebê-los sem verificar sua compatibilidade. O Forge & Flow não passa a oferecer envio, pausa, remoção de peças ou operação autônoma por adotar ideias de planejamento. [AutoFarm3D](https://www.3dque.com/autofarm3d).

## Aplicação à entrega atual do Forge & Flow

As decisões a seguir vêm da revisão do código local. A situação descrita é de implementação e validação local; não comprova disponibilidade no ambiente publicado.

| Frente | Implementado localmente | Limite que deve aparecer para o operador |
| --- | --- | --- |
| Histórico Bambu | Consulta direta pelo banco, atualização de tarefas existentes, controle de repetição, estado por dispositivo e retomada após reconexão. | A API fornece uma janela de tarefas e pode retornar menos registros do que o limite solicitado. A indicação usa o total informado pela Bambu; total ausente, inválido ou incoerente mantém o histórico como possivelmente incompleto. Consulta bem-sucedida não significa consumo apurado nem importação de todo o histórico. |
| Arquivo e rastreabilidade | Fontes de impressão ligadas ao SKU, upload de arquivo e cálculo SHA-256 de seu conteúdo no navegador. A apuração preserva uma cópia dos dados da fonte e da placa, incluindo o hash quando disponível. | Link externo não ganha hash calculado sem upload do conteúdo. Essa cópia histórica não equivale a um fluxo de aprovação de revisões imutáveis. |
| Múltiplas placas por SKU | Cada placa tem índice, nome, capacidade, material, impressora e estimativas próprios. Planejamento manual e pedidos geram uma ordem por impressão física de cada placa necessária. | Base e tampa são partes do mesmo SKU. O lote final usa a capacidade inteira cadastrada e identifica peças extras previstas; ainda não há simulação de ocupação parcial da placa. |
| Associação Bambu | Vínculo confirmado por modelo, perfil e índice observado, preservando a fonte pai e os vínculos das outras placas. Duplicação de índice ativo dentro da mesma fonte é bloqueada. | Nome parecido é insuficiente para confirmar a associação. Identificadores ambíguos exigem correção; índice remoto ausente ou inválido não é adivinhado. |
| Apuração Bambu | Conferência do produto/placa, quantidade de peças, materiais e alocação para ordens. Uma tentativa física lança consumo e custo uma vez, com origem e pendências visíveis. | Peso do fatiador usado após conclusão permanece identificado como referência do fatiador. Tentativa interrompida ou com objetos pulados exige consumo informado por medição. Tempo previsto não substitui duração decorrida. |
| Referência de custo do produto | Médias unitárias por placa, ponderadas pelas quantidades apuradas. O SKU soma todas as placas ativas; edição do produto recalcula o agregado. | Uma placa sem referência mantém o realizado total incompleto. Estimativas podem preencher a referência de planejamento somente quando todas as partes têm custo conhecido. A margem comercial não altera vendas passadas. |
| Automação de apuração | Perfil explícito por dispositivo/projeto, com materiais, quantidades e parâmetros confirmados; início de vigência para novas ocorrências. | Histórico anterior à habilitação não deve ser baixado automaticamente. Ausência de material, saldo ou dados suficientes gera pendência, sem inventar resultado. |
| ERP financeiro e produtivo | Compras, estoque, baixas financeiras, pedidos, kits, falhas e reimpressões com transações e proteção contra repetição. | DRE gerencial e legado incompleto continuam identificados. Esta integração não transforma toda previsão em medição. |
| Experiência de uso | Formulários responsivos, navegação consistente e estado de carregamento/erro; acesso ao histórico e à conferência pelo celular. | A interface não acrescenta comandos físicos de impressão. |

O histórico remoto, a ordem do ERP e o lançamento de consumo têm identidades distintas. Uma tarefa Bambu representa uma tentativa física; uma placa pode produzir várias peças; um produto pode exigir várias placas. Por exemplo, cinco conjuntos com base em lotes de duas peças e tampa em lotes de três geram três impressões da base e duas da tampa. Cada lado prevê seis peças, com uma extra identificada. O rateio preserva os centavos da venda e não cria uma nova receita para as peças extras.

**O upload não interpreta automaticamente o 3MF, STL ou G-code.** O código atual armazena o arquivo e calcula seu hash; placas, capacidade e estimativas são cadastradas pelo operador. Metadados recebidos no histórico Bambu servem para conferir a associação e a apuração. Eles não representam uma importação completa da geometria, dos objetos, da disposição na mesa ou dos parâmetros internos do arquivo.

**Qualidade está em integração final na migration 033.** Esse ajuste trata separadamente o resultado físico informado pela Bambu e a inspeção: uma impressão concluída pode gerar uma ordem rejeitada depois. A rejeição deve preservar o consumo e o custo da tentativa, sem baixar material novamente, e excluir a parcela rejeitada da referência de produção aceita. A reimpressão conserva a ligação com a tentativa anterior. A aceitação/rejeição parcial entre várias ordens alocadas é distinta de dividir, dentro de uma única ordem, oito peças boas e duas rejeitadas; esse segundo caso permanece no roteiro futuro.

A validação local já cobre pedidos com várias placas, capacidade diferente por placa, custos parciais, kits, fechamento dos centavos, repetição segura de operações, transações revertidas quando uma etapa falha, preservação da fonte pai, edição do produto e o fluxo pedido → ordens → apuração Bambu. A revisão de qualidade requer sua própria conclusão de integração e testes. Esses ensaios usam banco PostgreSQL isolado com dados fictícios; não comprovam autenticação, dados ou comportamento do ambiente publicado.

## Próximas melhorias, em ordem de prioridade

As prioridades abaixo são recomendações de projeto ainda não entregues. Hash calculado no upload, cadastro de várias placas, capacidade por placa e cópia histórica da fonte na apuração já fazem parte da implementação atual e não são tratados como próximos recursos. A ordem considera dependências e redução de erro operacional, sem estimativa comercial de prazo.

### 1. Aprovar revisões imutáveis de arquivo e preparação

Partir das fontes, hashes, placas e cópias históricas já existentes para acrescentar revisões imutáveis com aprovação, autoria e vigência. A revisão aprovada deve ficar fixada na ordem quando ela for planejada, além da cópia já preservada na apuração. Repetir um nome de arquivo com conteúdo diferente deve gerar outra revisão, com nova conferência das regras automáticas.

**Critério de conclusão:** abrir uma ordem ainda não produzida permite identificar a revisão aprovada que deverá ser usada, mesmo após atualizar o cadastro do produto. Mudança de hash ou preparação exige nova aprovação antes de reutilizar uma regra automática. Importar objetos, placas e parâmetros internos de um 3MF seria uma evolução separada, com validação de formatos e confirmação do operador; não existe no fluxo atual.

### 2. Individualizar bobinas, lotes e reservas de material

Adicionar identidade por bobina, etiqueta QR, lote/compra de origem, tara, saldo, localização e associação ao slot da impressora. A entrada de várias bobinas deve conciliar quantidade física, gramas recebidas e custo de aquisição. O operador precisa conseguir escanear, carregar, retirar e conferir o saldo pelo celular.

**Critério de conclusão:** toda baixa identifica bobina e trabalho; a soma das bobinas concilia com o material agregado. Ajustes têm motivo e autoria. Reservar filamento para a fila reduz o disponível para outros trabalhos, mas só o consumo confirmado reduz o estoque físico. O custo de compra não é lançado novamente na produção.

### 3. Investigar coleta local para impressões interrompidas

Avaliar um coletor LAN dedicado, inicialmente de leitura, para eventos de início/fim, mudanças de material e informação de extrusão realmente disponibilizada pelo equipamento. Antes de implementar, verificar o que cada modelo e firmware expõe: não presumir que a API cloud ou o protocolo local forneça um contador confiável por bobina.

**Critério de conclusão:** comparar a coleta com pesagem em impressões completas e interrompidas, incluindo purga, suporte, retomada e troca de bobina. Cada valor informa origem, período coberto e lacunas. Perder comunicação gera uma pendência de medição; não autoriza completar o consumo por regra de três sobre tempo ou progresso. Estimativa do arquivo, dado recebido da máquina e medição conferida devem permanecer distinguíveis.

### 4. Registrar quantidades parciais de qualidade dentro da mesma ordem

Ampliar a rejeição da ordem e a reimpressão já existentes para informar quantidades boas, rejeitadas e retrabalhadas dentro de uma única ordem com várias peças. Acrescentar evidência e responsável pela inspeção e permitir reposição apenas da quantidade rejeitada. A rejeição de uma ordem inteira não deve ser apresentada como suporte completo a esse controle parcial.

**Critério de conclusão:** uma placa terminada com dez peças, das quais duas foram rejeitadas, registra oito boas e duas rejeitadas; uma nova tentativa repõe as duas, sem criar doze peças entregues ou cobrar duas vezes a mesma venda.

### 5. Planejar carga e disponibilidade com reservas

Evoluir a fila para disponibilidade por máquina, material, bico, prazo, manutenção e revisão compatível. Incluir troca de material, preparação e coleta na previsão de ocupação. Apresentar conflitos, atraso previsto e alternativas de alocação com confirmação do operador.

**Critério de conclusão:** duas ordens não podem contar com a mesma disponibilidade ou bobina reservada; mudanças de prioridade mostram o impacto nas demais entregas. As sugestões não enviam comandos à impressora. Automação física exigiria um projeto separado.

### 6. Comparar custo previsto, apurado e preço futuro

Evoluir a referência atual de gramas, duração e custo por placa para uma análise das diferenças por revisão, máquina, material e componente de custo. A origem medida ou recebida do fatiador já é identificada; falta a análise detalhada que explique desvios recorrentes e proponha revisão dos parâmetros. Separar efeitos de perdas, energia, trabalho e acessórios, sem reescrever pedidos ou custos já fechados.

**Critério de conclusão:** o operador consegue explicar a diferença em reais e localizar os trabalhos que a causaram. Uma proposta de preço futuro considera custos atualizados e parâmetros comerciais explícitos; ela não altera automaticamente o preço já acordado com o cliente. Custos ausentes mantêm a análise parcial.

## Como avaliar o próximo ciclo

Os indicadores propostos para acompanhar a evolução são: percentual de tarefas com SKU/revisão identificados; percentual de consumo com origem e material confirmados; tempo até resolver uma pendência; divergência entre bobina pesada e saldo registrado; peças boas/rejeitadas por tentativa; diferença entre custo previsto e apurado; e entregas atrasadas por indisponibilidade de máquina ou material. As metas devem ser definidas após medir a operação; este documento não inventa percentuais de ganho.

A próxima decisão técnica depende da conclusão da integração, da publicação verificada e da observação da operação. Tarefas completas, falhas, repetição de eventos e dados insuficientes já fazem parte dos ensaios locais; o ciclo publicado deve confirmar esses comportamentos antes de ampliar a automação.
