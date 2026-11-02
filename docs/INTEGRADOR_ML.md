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

As migrações 20261102235500 e 20261102235600 do Forge e a 20261102235500 do Integrador foram aplicadas e verificadas. Não foram criadas associações reais nem alteradas credenciais, quantidades ou preços de anúncios durante os testes. A ativação depende da escolha das contas existentes no Integrador: COZINHAMODERNA1088021376 e PONTOAPONTOEQUIP1081358772. A publicação do código não substitui essa escolha e os vínculos de produtos.

A implementação da ponte está no [commit do Integrador](https://github.com/Guilherme-pedrosa/wedo-ml-integration/commit/289ed1e5376577ca6ce5022fce000f2f5c19d6c7). Foram conferidos 283 arquivos de produção da origem para identificar os escritores de ofertas. Os testes isolados cobrem autenticação, permissões, configuração, pedidos, repetição, falhas incertas e concorrência; testes do navegador autenticado com contas reais continuam dependendo da ativação.
