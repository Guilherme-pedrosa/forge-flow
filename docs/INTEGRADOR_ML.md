# Mercado Livre no Forge

O Forge usa a ponte do repositório Guilherme-pedrosa/wedo-ml-integration. A conexão mantém o Integrador como proprietário das credenciais Mercado Livre e do processo de renovação. O navegador envia somente a sessão normal do Forge, de forma transitória, ao endpoint fixo da ponte. A ponte confirma o usuário no Supabase Auth, o papel, a empresa e as contas aprovadas nas duas bases antes de operar. Nenhum token de Mercado Livre é copiado para o Forge ou para a extensão de fatiamento.

## Uso

Em Mercado Livre e Shopee, a configuração do Integrador apresenta parâmetros reais, credenciais configuradas, contas associadas e filas. Credencial armazenada e validação remota são estados diferentes. A validação de uma conta consulta o vendedor remoto; cadastrar ou associar um nome não autoriza a API. Parâmetros globais só podem ser alterados com perfil financeiro e aprovação de todas as contas ativas afetadas. Segredo vazio preserva o valor existente.

O operador consulta anúncios, escolhe o produto do Forge e confirma o vínculo. Pedidos podem ser consultados por IDs ou período e entram no mesmo fluxo de conferência e atendimento dos demais canais. Um vínculo não assume o controle do estoque automaticamente.

A conferência de estoque e preço mostra todos os anúncios afetados. O saldo vem do estoque livre do Forge, descontando pedidos pagos ainda não atendidos e conferindo a reserva ou a baixa correspondente. O preço usa o aceite de Mercado Livre para uma unidade; o preço base do catálogo e o acréscimo legado do GC não o substituem. Uma nova conferência é exigida quando estoque, pedidos, vínculos ou condições mudam.

Assumir o controle é uma alteração de responsabilidade, sem envio de quantidade ao Mercado Livre. Depois, atualizar estoque ou preço exige revisar e confirmar a operação. O servidor relê os dados e calcula os valores; o navegador não escolhe quantidades ou preços arbitrários. Uma resposta incerta não repete um envio automaticamente. Anúncios pausados manualmente ou por moderação são preservados.

## Estoque compartilhado e limites

Anúncios de um mesmo User Product e de um mesmo estoque físico anterior precisam de responsabilidade coerente. Variações ou armazéns sem conferência completa, pedidos pendentes na fila anterior e saldos compartilhados com outro canal bloqueiam a transferência. O estoque compartilhado com a Amazon no Integrador deve ser resolvido antes de transferir o produto; o sistema não zera nem altera o outro canal para contornar essa pendência.

Os fluxos antigos de Mercado Livre, Growth e Amazon respeitam os produtos transferidos, inclusive na criação de um novo vínculo concorrente. Os demais produtos continuam no fluxo anterior. A sincronização dos produtos assumidos pelo Forge nesta etapa é manual, após conferência. O cron antigo continua atendendo aos produtos não transferidos; ele não usa uma sessão de navegador expirada para executar uma sincronização automática do Forge.

## Entrega e ativação

As migrações 20261102235500, 20261102235600 e 20261102237000 do Forge e as 20261102235500 e 20261102237000 do Integrador foram aplicadas e verificadas. Não foram criadas associações reais nem alteradas credenciais, quantidades ou preços de anúncios durante os testes. O usuário definiu que nenhuma conta anterior será vinculada. A conexão será da nova conta Elevare3D: no Forge, escolha o cadastro pendente e autorize a conta administradora correspondente na página do Mercado Livre. O retorno é para o Forge; sessão expirada preserva esse retorno após o login. A conta só é ativada após validação da identidade, permissão financeira e confirmação entre os servidores. Nenhum token vai para a URL ou o navegador.

A implementação da ponte está no [commit do Integrador](https://github.com/Guilherme-pedrosa/wedo-ml-integration/commit/41a592f51b7d4334199521e826ab9d742449b6d0). Foram conferidos 283 arquivos de produção da origem para identificar os escritores de ofertas. Os testes isolados cobrem autenticação, permissões, configuração, pedidos, repetição, falhas incertas e concorrência; testes do navegador autenticado com contas reais continuam dependendo da ativação.


## Nova conta Elevare3D

Uma aprovação inicial com zero vendedores permite iniciar a autorização sem associar contas antigas. A nova conta gerenciada pelo Forge fica permanentemente fora das rotinas legadas de estoque, preços e vendas do GC, inclusive enquanto a conexão está pendente ou revogada. A autorização usa código e desafio PKCE S256, estado de uso único e recibo com expiração. A prova entre os servidores é privada; apenas seu hash fica no Forge. Credenciais só são ativadas depois da confirmação financeira. Falhas intermediárias podem ser retomadas sem outro cadastro, e uma conta já pertencente a outra operação não é reutilizada.

O operador deve entrar na conta administradora Elevare3D no Mercado Livre antes de autorizar e conferir a conta apresentada pelo provedor. O sistema não acrescenta parâmetros não documentados para forçar a troca de login. A aplicação Mercado Livre deve estar configurada para PKCE; os testes locais verificam a construção S256 e a validação do fluxo, mas não alteram nem comprovam a configuração do painel do provedor.
