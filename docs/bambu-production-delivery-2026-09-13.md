# Forge & Flow — produção Bambu, arquivos e várias placas

## Escopo entregue

Esta entrega continua a [revisão do ERP](erp-review-2026-09-12.md). Reúne os pedidos de integrar produção efetiva, estoque, custos, falhas, identificação de produtos por arquivo/link e projetos com várias placas. O [benchmark](benchmark-print-farm-2026-09-13.md) separa as funções implementadas das sugestões para o próximo ciclo.

Código preparado a partir de `50851c4a01f794de285d677e707be8e640cb7dd4`, na branch `Codex/local-preparacao-bambu-producao-real`, e enviado à `main` no commit `0dc28d99175dd5068c458f13a6bf9ae90281d3c0`. Versão publicada em [elevare3d.lovable.app](https://elevare3d.lovable.app), com conferência dos módulos servidos às 08:44 de 13/09/2026 (Brasília). Todo o trabalho usou GitHub e ferramentas diretas de infraestrutura. Nenhuma mensagem ao agente do Lovable.

## O que mudou

| Pedido | Comportamento implementado |
| --- | --- |
| Acompanhar a produção efetiva | O histórico passa a atualizar tentativas já importadas. Estados 1 e 4 continuam em andamento; 2 concluiu e 3 falhou. Estado ausente/desconhecido impede apuração. |
| Atualizar tempo e custo | A tentativa registra tempo decorrido entre início/fim ou tempo conferido, gramas por material, custo de aquisição do estoque, energia, máquina, trabalho e adicionais. O cadastro recebe referências por unidade e quantidade de amostras. |
| Filamento e prejuízo | Uma tentativa desconta material uma única vez. Falha exige consumo informado e motivo, gera perda e zero peças boas. Saldo insuficiente desfaz a operação inteira. |
| Qualidade | Rejeitar uma OI retira suas unidades e custos da referência de peças boas, conserva o resultado físico Bambu e registra o material perdido sem repetir a baixa. Várias OIs da mesma impressão contam apenas uma tentativa física com falha. |
| Reconhecer produto | Arquivos privados STL/3MF/GCODE e links HTTPS ficam associados ao SKU. O vínculo com uma impressão confirma modelo, perfil e placa da Bambu. Nome parecido não determina produto. |
| Várias placas | Cada placa tem rendimento, material, impressora, previsão, amostras e fila próprios. A referência do SKU soma as placas necessárias. Base + tampa nunca viram uma média entre duas peças completas. |
| Fila e pedidos | A quantidade do pedido gera lotes físicos conforme a capacidade de cada placa. O planejamento mostra impressões e sobra prevista. O rateio conserva o valor da venda sem duplicá-lo entre placas. |
| Conferência e celular | Histórico paginado, cartões no celular, formulários com campos rotulados e erros que preservam o preenchimento. Vínculo, materiais e apuração ficam disponíveis no mesmo fluxo. |
| Repetição e auditoria | Tentativa, ordem e movimento de estoque têm identidades distintas. Repetir sincronização/apuração não cria novos custos. Arquivo, placa, parâmetros de custo e dados remotos são preservados na fotografia da apuração. |

## Como configurar a operação

1. Em **Comercial → Produtos**, abrir o produto e cadastrar seu arquivo ou link em **Arquivos e links de impressão**. Arquivos têm limite de 50 MB e download privado temporário.
2. Cadastrar as placas necessárias ao produto: nome, índice observado na Bambu, quantidade de unidades atendidas por impressão, material, impressora e previsões. Uma base e uma tampa são duas placas do mesmo SKU; as duas precisam estar na fila e no custo. Somente placas necessárias à configuração atual do SKU devem ficar ativas.
3. Em **Integrações → Bambu Lab**, sincronizar e abrir **Vincular produção** na tentativa correta. Confirmar produto, placa, quantidade e cada filamento do estoque. Uma sugestão proveniente de nota antiga é apenas uma sugestão.
4. Escolher se novas tentativas desse perfil/dispositivo podem ser apuradas automaticamente após conclusão. O uso do peso do fatiador é uma opção explícita e aparece identificado na apuração. Ativar a regra não desconta o histórico antigo.
5. Nas falhas ou impressões com objetos ignorados, informar os gramas realmente consumidos. Uma impressão concluída segue para qualidade; a conclusão física não entrega o pedido nem cria venda.
6. Usar a fila ou produzir um pedido para gerar os lotes das placas. Havendo várias ordens compatíveis com a mesma tentativa, conferir a alocação: o sistema não escolhe o cliente pelo nome do arquivo.

## Limites dos dados

O campo `weight`, o tempo `costTime` e os pesos por AMS encontrados no histórico cloud são previsões do arquivo. O código oficial do [Bambu Studio](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/TaskManager.cpp) distingue os estados de impressão e resultado. A inspeção dos dados deste projeto confirmou que uma falha de poucos segundos pode repetir exatamente o peso previsto de uma impressão completa.

Por isso, peso previsto não é apresentado como pesagem real. Uma falha não desconta automaticamente o peso inteiro nem uma fração calculada pelo tempo. O tempo início/fim é tempo decorrido e pode incluir pausas; não é um contador de extrusão ativa. A coleta LAN e a rastreabilidade por bobina/QR são melhorias futuras descritas no benchmark.

O cadastro guarda arquivo/hash e vínculos explícitos, mas não analisa automaticamente o conteúdo do 3MF ou de páginas externas para descobrir todas as placas. Elas são cadastradas e associadas ao histórico. A leitura do arquivo para sugerir placas e um fluxo de aprovação de revisões continuam sendo evoluções possíveis.

A sincronização solicita uma janela de tarefas por dispositivo. A Bambu pode devolver menos registros que o limite pedido; a consulta real retornou 20 por impressora. A interface avisa quando o total remoto indica registros faltantes ou quando não há metadados que confirmem a abrangência. A paginação automática de todo o histórico remoto não faz parte desta versão. As 529 tarefas que já estavam no ERP foram preservadas. Falhas de autorização, rede ou dados aparecem por dispositivo e conservam a última consulta bem-sucedida.

A rejeição de qualidade pode atingir uma ou várias OIs da mesma tentativa. Dentro de uma única OI, a operação reprova sua quantidade inteira. Separar unidades boas/rejeitadas dentro de uma só OI continua no roteiro de evolução.

## Organização do código

- `20260913030000_bambu_production.sql`: vínculo, apuração transacional, estoque e auditoria.
- `20260913031000_bambu_direct_sync.sql`: consulta cloud com fila interna, atualização do histórico, intervalo mínimo e repetição após falhas. Substitui o agendamento antigo que recebia HTTP 401.
- `20260913032000_product_plates.sql`: placas, referências agregadas, lotes, pedidos e reimpressões.
- `20260913033000_bambu_quality.sql`: rejeições, perdas de qualidade e referências líquidas de peças rejeitadas.
- `20260913034000_bambu_history_window.sql`: aviso de abrangência do histórico baseado no total remoto ou na ausência desse metadado.
- `BambuProductionPanel`, `ProductPrintSources`, `ProductPrintPlates` e `ProductionPlatePlan`: interfaces de conferência e planejamento.
- Adaptadores de RPC preservam a instância do cliente Supabase; a correção também alcança produto, pedido, consignação e movimentação de estoque.

## Verificação

Comandos reproduzíveis: `npm run typecheck`, `npm test`, `npm run test:database`, `npm run test:bambu` e `npm run build`. Os testes PostgreSQL usam bancos locais isolados, materiais e impressoras fictícios. Não iniciam impressões nem criam transações de teste no ERP real.

Resultado: 212 testes de interface/lógica e 85 cenários PostgreSQL passaram; typecheck e build também. O navegador foi conferido em 320, 390 e 1440 pixels, com dados fictícios, incluindo campos, seletores, erro de apuração, planejamento e rejeição. A simulação não equivale a uma pesagem física nem a um teste de teclado num iPhone real.

Casos cobertos incluem atualização de tarefa em andamento, status ausente, opt-in do fatiador, consumo parcial medido, múltiplos materiais, saldo insuficiente, repetição, rateio entre ordens, dados entre empresas, várias placas, kits, centavos, mudança de produto e revisão dos vínculos.

Antes da aplicação, o banco real tinha 529 tarefas Bambu, uma ordem, um movimento de estoque, seis títulos a pagar e nenhum título a receber. A implantação não deve apurar esse histórico automaticamente nem alterar esses saldos.

As quatro migrations principais foram aplicadas juntas em 13/09/2026. A consulta real respondeu HTTP 200 para os dois dispositivos às 08:37 (Brasília), atualizando 20 tarefas de cada um. A conferência posterior preservou as 529 tarefas, as contagens de ordens/movimentos/títulos e os saldos/custos médios dos oito materiais. Nenhuma tentativa histórica foi contabilizada. O agendamento novo está ativo e o antigo está desativado.

A migration 034 também foi aplicada; o ciclo das 08:43 confirmou HTTP 200 nos dois dispositivos e o aviso de possível histórico incompleto. A publicação direta teve identificador `51f64cd9-d7d6-4a15-88a5-ef2797e3f0e7`. Foram verificados HTTP 200 e os novos contratos/textos nos módulos publicados de Bambu, Produtos e Perdas. A última etapa operacional para cada perfil é confirmar o produto, a placa e os filamentos utilizados antes de habilitar sua apuração automática.
