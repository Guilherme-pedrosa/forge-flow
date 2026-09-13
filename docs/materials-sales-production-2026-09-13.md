# Matérias-primas, orçamento e produção

O fluxo é: item exato do estoque → composição versionada do produto/placa → orçamento → pedido aprovado e recebível → lotes de impressão → apuração física e estoque.

## Operação

1. **Estoque → Materiais e insumos:** cada filamento identifica material (PLA, PETG, variantes etc.), cor e código de cor. O saldo pertence ao item, inclusive quando ele está organizado sob um item pai. Cor de amostra hexadecimal é opcional.
2. **Comercial → Catálogo de produtos:** cadastrar arquivo/link e placas necessárias. Definir a composição de cada placa com todos os materiais/cores e os gramas por peça ou impressão completa. Confirmar os demais custos por unidade e o tempo de impressão. Arquivos com várias placas precisam de cada placa cadastrada.
3. **Comercial → Orçamentos:** salvar rascunho, conferir a composição e emitir. Emissão preserva preços, materiais, cores, custos, capacidades e referências dos arquivos. A previsão considera lotes completos e eventuais peças extras. Alterações futuras do catálogo não reescrevem a proposta.
4. Registrar aprovação do cliente e **Converter em venda**. A operação cria, na mesma transação, um pedido aprovado e um recebível. Repetir não cria segunda venda nem segundo título. Um orçamento isolado não gera recebível.
5. No pedido, mudar para **Em produção**. A fila contém uma ordem por impressão física de cada placa, com capacidade e excedente explícitos. Kits geram os componentes e rateiam extras e receita sem perder centavos.
6. Na fila ou nas ordens, **Arquivo e materiais** permite conferir a receita preservada, saldo atual, arquivo e máquina. Um arquivo ausente pode ser associado ao mesmo produto com justificativa antes de produzir. Arquivos preservados não são substituídos silenciosamente.
7. Baixar o arquivo privado, conferir placa, modelo, bico e AMS no Bambu Studio/Connect e enviar por esse software. O ERP não inicia impressões diretamente nesta entrega.
8. Na apuração Bambu, associar a tentativa às ordens corretas e informar consumo efetivo. Todos os itens precisam corresponder à composição preservada. Falhas geram perda com os gramas medidos. A confirmação de consumo é atômica e não duplica a baixa.

## Critérios de custo e histórico

- Nova composição: custo médio atual de cada matéria-prima, convertido uma vez entre g/kg, mais os demais custos confirmados. O custo antigo do produto não determina o custo da nova composição.
- Orçamento emitido: preserva sua previsão, incluindo lotes completos. Margem prevista exclui frete, tributos e despesas financeiras e está identificada dessa forma na tela.
- Produção efetiva: mantém consumo, tempo e custos apurados separados das estimativas. Peso previsto do fatiador não comprova consumo parcial. Consumo completo do fatiador exige autorização explícita por perfil e tentativa concluída sem objetos ignorados.
- Reimpressões conservam a composição e arquivo da ordem original, sem copiar sua baixa de estoque.
- Receitas antigas protegem a identidade e unidade dos itens referenciados. Uma nova cor deve ter outro item; alterar a composição cria uma nova versão.
- Pedidos anteriores à migração mantêm seu fluxo histórico. Novos pedidos exigem composição completa para aprovação.
- Migração de identidade aproveita apenas campos estruturados já preenchidos com tipo controlado e cor válida; registra os valores originais na auditoria. Não deduz material por nome, fornecedor, compra ou item pai. Não cria composições automaticamente.

## Limites e próximos passos

- **Envio direto:** depende de um canal autorizado de despacho. O projeto tem consulta de histórico Bambu Cloud; não tem ponte local, endereço LAN das máquinas ou integração SDK/Connect de despacho. Não existe botão que simule um envio inexistente. A autorização da Bambu para controle é distinta da consulta de dados: [controle de autorização](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/) e [integrações via Bambu Connect](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/).
- **Arquivo e placas:** o cadastro contempla múltiplas placas; a descoberta automática de placas dentro de 3MF ainda não foi implementada. Modelos STL e links podem exigir download/fatiamento antes de existir um arquivo adequado à máquina. A preparação não certifica compatibilidade de fatiamento.
- **Estoque disponível:** a preparação exibe saldo atual, sem reserva antecipada. A baixa valida o saldo de todos os materiais e desfaz a transação inteira se algum for insuficiente.
- **Três ou mais materiais:** a apuração Bambu registra todos os filamentos; a conclusão manual antiga aceita até dois. O sistema bloqueia uma conclusão manual incompleta.
- **Configuração existente:** a divisão de consumo por cor e os demais custos da nova composição precisam ser conferidos no cadastro. Não há dados suficientes para converter automaticamente todos os produtos antigos em receitas aprovadas.

## Implementação e verificação

Migrações 035–038: identidades/receitas; orçamentos; preservação/preparação de arquivos; produção a partir da composição aprovada e validação Bambu. Todas as gravações comerciais e de produção usam funções transacionais e permissões por empresa.

Comandos de verificação: `npm run typecheck`, `npm test`, `npm run test:database`, `npm run test:bambu`, `npm run test:materials`, `npm run build`. Os testes PostgreSQL rodam em PGlite isolado, sem conexão com impressoras ou dados do ERP real. Fixtures visuais locais usam exclusivamente dados fictícios.

Nenhuma mensagem ou execução do agente Lovable é necessária. Código pelo GitHub; migrações e publicação pelas ferramentas internas diretas.

## Resultado desta entrega

- Base de código: `ef15d2d66699845bea16150fa52ddd49a35e4b2d`; preparação em `Codex/local-preparacao-fluxo-materiais-vendas`.
- 243 testes Vitest e 126 cenários PostgreSQL passaram, além de typecheck e build. Após separar a receita da placa em um painel próprio, os 7 testes dos componentes afetados também passaram.
- Conferência visual local em 320, 390 e 1440 px. A receita da placa foi retirada das caixas aninhadas para manter campos utilizáveis em 320 px. Essa verificação não substitui teste do teclado físico de um iPhone.
- Migrações 035–038 aplicadas atomicamente no banco real. Sete identidades de material/cor foram preservadas a partir dos campos existentes; `PLA PREMIUM` sem cor permaneceu pendente.
- Comparação anterior/posterior confirmou os mesmos oito saldos/custos de estoque e as mesmas contagens: 1 ordem de produção, 1 movimentação, 10 pedidos, 6 contas a pagar e 0 contas a receber. Nenhuma receita, orçamento, venda ou impressão de teste foi criada no ERP real.
