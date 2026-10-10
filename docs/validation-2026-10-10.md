# Validação da atualização — 10/10/2026

Base revisada: `e737da9f6ff151eadae648308d44a5d7c39d5da2`. A [matriz de cobertura](coverage-2026-10-10.md) relaciona 53 requisitos do pedido, da entrevista e do plano com arquivos e pendências. Esta evidência valida contratos locais e comportamento de interface; a operação de produção ainda precisa ser ativada e aceita.

| Verificação | Resultado |
| --- | --- |
| `npm test` | 67 arquivos, 605 testes aprovados. |
| `npm run test:operations` | 127 contratos aprovados: físico 18, confirmação 14, bobinas 10, inbox 16, Edge ML 7, credenciais Shopee 5, Edge Shopee 10, política 8, estoque parcial/QC 22, repasses 17. |
| `npm run test:database` | 54 cenários gerais do ERP aprovados. |
| `npm run test:bambu` | 49 cenários aprovados de apuração, sincronização isolada, placas e qualidade. |
| TypeScript e pacote de produção | Aprovados; o build conserva o aviso existente de chunks grandes. |
| Navegador em 1440 e 390 px | Hoje/próxima ação, bobinas/pesagem, reposição, ML/Shopee, política desligada por padrão, repasse e capacidade; sem erro de execução, gravação operacional ou transbordamento horizontal. |
| Revisão independente | Contratos de integração, bobinas, política/estoque parcial/QC e financeiro revisados; nenhum bloqueador conhecido restante. |

Os scripts PostgreSQL criam bancos isolados com PGlite e aplicam as migrações. Os handlers Edge são exercitados com sessões, APIs e banco simulados; também foi conferido o bundle. A documentação oficial da Shopee foi consultada e os vetores HMAC verificados de forma independente. Nenhum desses resultados comprova execução no runtime Deno/Supabase, OAuth real ou disponibilidade da API do vendedor.

Casos relevantes cobertos: mesma operação não duplica estoque/títulos/OP/jobs/caixa; alteração de prazo externo não desaparece por conflito interno; conta, variante e empresa permanecem isoladas; manutenção não é encerrada pela telemetria; ficha incompleta desfaz a tentativa de organização; produção atende só o saldo após estoque pronto; QC exige quantidade boa; reimpressão conserva origem e receita zero; repasse preserva bruto e lança somente líquido real; cancelamento de principal retido elimina a previsão sem criar caixa fictício.

O processamento paralelo de duas sessões PostgreSQL reais, a pesagem/inventário da farm, os turnos e arquivos reais, a sincronização contínua dos canais e o piloto com Gleyce permanecem pendentes. Não houve alteração do banco operacional, envio de comando para impressora ou contato com Lovable. O [guia de implantação](operacao-3d-2026-10-10.md) identifica migrações, funções e configuração necessários.
