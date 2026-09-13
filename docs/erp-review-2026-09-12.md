# Forge & Flow — revisão do ERP em 12/09/2026

A revisão tratou o Forge & Flow como sistema de gestão da impressão 3D: compra de materiais, estoque, custos de produção, venda, consignado e financeiro precisam representar a mesma operação. O trabalho corrigiu os principais pontos de quebra desses vínculos e reorganizou a interface para uso no computador e no celular.

Base da revisão: `fbf1212972c835947ada66e5b22b5ddd76fc7866`, na branch `Codex/local-preparacao-forge-erp`. O trabalho foi feito no código e nas ferramentas internas diretas. Nenhuma mensagem foi enviada ao agente do Lovable.

## Causas e mudanças implementadas

**Operações incompletas e duplicações.** Compra, parcelas, estoque, baixa financeira e produção eram gravados em chamadas independentes. Um erro intermediário podia deixar parte da operação salva; repetir a ação podia duplicar registros ou saldos. Os fluxos principais agora usam operações transacionais no PostgreSQL. Cada tentativa de criação ou lançamento mantém um identificador: repetir o mesmo conteúdo retorna o resultado existente; reutilizá-lo com conteúdo diferente é recusado. Recebimento de compra e transições de produção também impedem uma segunda baixa. Falha em uma linha desfaz a operação inteira.

**Custo de impressão e unidade de medida.** A previsão confundia valores por placa com valores por peça, podia substituir zero por um valor padrão e acrescentava um frete já incorporado ao custo médio do material. Peso, tempo e acabamento por placa agora são distribuídos pela quantidade de peças; acessórios são tratados na unidade correspondente. Material e impressora precisam estar identificados quando utilizados. O custo real considera consumo medido, máquina, energia, mão de obra, despesas adicionais e acessórios. Consumo em gramas é convertido para a unidade de estoque, inclusive quilogramas. Purga, suporte e perda fazem parte do consumo total informado; a perda não é somada novamente.

A primeira saída da impressão registra consumo e custo. Avançar para acabamento, qualidade ou conclusão preserva essa apuração. Rejeição na qualidade conserva a baixa já feita; reimpressão cria uma nova ordem vinculada, com suas próprias medições. A ausência de custo continua ausente, sem virar custo zero ou lucro aparente. Ordens antigas com consumo já lançado exigem conferência antes da regularização.

**Compras e financeiro.** A compra cria pedido, itens e parcelas juntos. O recebimento exige a conversão explícita para estoque: um rolo de 1 kg deve entrar como 1000 g quando o material usa gramas. Frete, desconto e outros componentes do total documental participam do custo de aquisição. A importação permite revisar valores; parcelas precisam fechar o total, incluindo centavos. Nota repetida é bloqueada.

Baixas parciais e totais exigem conta bancária e atualizam título, extrato e saldo na mesma transação. Valores já pagos ou recebidos não podem ser apagados por uma edição ou nova tentativa. Títulos vinculados são tratados pela compra ou pelo pedido de origem; títulos manuais sem baixa podem ser cancelados. As consultas usadas nos totais percorrem todas as páginas, e uma consulta incompleta não é apresentada como resultado completo.

**Produtos, pedidos e consignado.** Produto e galeria são salvos juntos, incluindo remoção de fotos; uma foto inválida desfaz a alteração. A composição de kits rejeita referências inválidas e ciclos. Aprovar o pedido cria o recebível; iniciar a produção gera ordens por peça e desmembra kits. O rateio da receita descontada fecha em centavos entre linhas e entre peças, sem receita negativa por arredondamento. Custos e acessórios ficam registrados nas ordens, preservando o histórico quando o catálogo muda.

O consignado registra colocação, reposição, venda e recolhimento com validação do saldo. A comissão é um campo próprio, com padrão de 20% e respeito ao valor explícito de 0%; venda bruta, comissão e repasse líquido permanecem identificáveis. A venda gera pedido e recebível do repasse. Conferência de saldo exige motivo e recusa uma tela desatualizada. Produto com peças consignadas e impressora com ordens ativas não podem ser arquivados antes de resolver esses vínculos.

**Acesso e isolamento.** O banco valida permissões e referências da mesma empresa, além dos filtros da interface. Alterações diretas que contornavam o histórico financeiro, o estoque ou os custos reais foram restringidas. Anexos privados e gravações de imagens respeitam a pasta da empresa; o token da conexão Bambu deixa de ser retornado ao navegador. A sessão ignora consultas antigas após logout ou troca de usuário, limpa o cache anterior e distingue falha de conexão de perfil ainda não cadastrado. As telas privadas aguardam sessão e perfil válidos.

## Interface e desempenho

O frontend recebeu uma identidade consistente para o ERP, navegação por áreas, busca funcional de módulos, hierarquia de valores e ações claras. Menu, formulários e diálogos foram reorganizados para telas estreitas. Estados de carregamento, erro, ausência de dados e informações incompletas substituem indicadores fictícios e ações sem efeito.

O painel reúne caixa, títulos em aberto, produção e pendências reais. O gráfico de produção identifica estimativas e custos faltantes; ele não se apresenta como DRE. A telemetria diferencia informação antiga, indisponibilidade e estado informado da impressora. A fila representa planejamento, sem prometer iniciar fisicamente uma máquina.

As páginas agora carregam sob demanda. A estrutura de navegação e os controles de acesso permanecem montados durante o carregamento da página. O JavaScript inicial caiu de aproximadamente **1.526 KB para 637 KB**; com gzip, de **416 KB para 190 KB**, redução de aproximadamente 54% no conteúdo comprimido. O dashboard fica em um arquivo separado de 403 KB, ou 112 KB com gzip; esse conteúdo ainda é necessário ao abrir o painel.

## Validação e alcance da evidência

| Verificação | Resultado |
| --- | --- |
| Testes Vitest | 141 testes passaram: cálculos, entradas inválidas, paginação, formulários e isolamento de sessão, entre outros fluxos. |
| PostgreSQL isolado com PGlite | 36 cenários passaram, carregando as migrations e exercitando transações, reversão por erro, repetição segura, permissões, isolamento entre empresas, centavos, custos, kits e consignado. |
| Typecheck | `npm run typecheck` passou, usando `tsconfig.app.json`. |
| Build | `npm run build` passou, com separação de páginas em arquivos carregados sob demanda. |
| Interface local | Verificada com dados fictícios em larguras de 320, 390 e 1440 px. Os fluxos observados de pagamento e formulários de produto e pedido não apresentaram transbordamento horizontal. |

Os testes não criaram dados reais na operação. PGlite usa PostgreSQL isolado; os cenários de repetição e saldo desatualizado não equivalem a um ensaio de carga com vários usuários simultâneos. A inspeção visual local não comprova autenticação na instância publicada, funcionamento em aparelho físico ou comportamento de todas as combinações de teclado e navegador móvel.

## Estado de publicação

**Preparado; verificar publicação no histórico Git e no banco.** Este relatório registra a entrega local validada. O estado efetivo do frontend e das seis migrations deve ser confirmado no histórico da publicação e no banco de destino, sem inferi-lo a partir do build local.

As migrations em `supabase/migrations/20260913010000_erp_integrity.sql` até `20260913015000_erp_job_creation.sql` cobrem integridade e financeiro, produção, vendas, consignado, proteções de escrita e criação de ordens. Os novos fluxos do frontend dependem dessas operações no banco; não existe fallback para as gravações independentes anteriores.

As correções de `create-user` e das funções Bambu estão no código. A publicação dessas edge functions não foi comprovada por este trabalho, pois não havia uma ferramenta direta de deployment disponível. A criação de usuário inclui validação e compensação para evitar identidade órfã quando perfil ou papel falham; isso depende da atualização da função no servidor.

Na inspeção do ambiente, o cron `bambu-hourly-sync`, com ação `all` e credencial anônima, apresentou **seis respostas HTTP 401**. A sincronização automática permanece uma pendência; a opção de sincronização manual foi mantida. A existência da opção não comprova sucesso de uma sincronização autenticada em produção.

## Limites que continuam explícitos

A DRE é gerencial e pode ser parcial no legado: receita por competência dos títulos e custo associado à produção não substituem fechamento contábil. Compras de estoque são separadas das despesas para evitar descontar material duas vezes. Títulos sem competência, despesas sem classificação, custos estimados e falhas sem apuração ficam sinalizados. Diferenças entre produção, entrega e reconhecimento da receita ainda exigem conferência no fechamento.

A conciliação é uma conferência **manual** de conta, data e valor com o extrato; não há importação automática de OFX ou integração bancária. Saldos, estoques e baixas antigos não foram recalculados nem receberam transações retroativas inventadas. A revisão corrige os fluxos e torna pendências visíveis; a regularização de registros antigos depende de conferir seus documentos e históricos.

Detalhes dos contratos e da revisão por domínio estão em [finance-auth-audit.md](finance-auth-audit.md), [finance-db-proposal.md](finance-db-proposal.md) e [production-db-proposal.md](production-db-proposal.md). Para execução, prevalecem os contratos das migrations entregues.
