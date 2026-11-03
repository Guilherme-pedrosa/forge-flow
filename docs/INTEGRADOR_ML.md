# Mercado Livre no Forge

O Forge usa a ponte do repositório Guilherme-pedrosa/wedo-ml-integration. A conexão mantém o Integrador como proprietário das credenciais Mercado Livre e do processo de renovação. O navegador envia somente a sessão normal do Forge, de forma transitória, ao endpoint fixo da ponte. A ponte confirma o usuário no Supabase Auth, o papel, a empresa e as contas aprovadas nas duas bases antes de operar. Nenhum token de Mercado Livre é copiado para o Forge ou para a extensão de fatiamento.

## Uso

O workspace usa uma conta selecionada e segue a ordem de navegação do Integrador. Os rascunhos são mantidos ao alternar as áreas da mesma conta; trocar de usuário ou empresa não carrega o rascunho anterior.

| Área | Rota | Operação implementada |
| --- | --- | --- |
| Dashboard | `/comercial/mercado-livre/dashboard` | Indicadores reais por período, com dados desconhecidos e consultas parciais identificados. |
| Publicar | `/comercial/mercado-livre/publicar` | Produto, categoria, atributos, dados comerciais e preço aceito; conferência antes de publicar. |
| Anúncios | `/comercial/mercado-livre/anuncios` | Pesquisa e situação no servidor, páginas, edição permitida pelo canal e vínculo com produtos. Estoque e preços ficam no painel `?painel=estoque`. |
| Pedidos ML | `/comercial/mercado-livre/pedidos` | Consulta Source sem importação, prévia e confirmação explícita para importar ao Forge. |
| Conciliação | `/comercial/mercado-livre/conciliacao` | Pedidos, pagamentos, tarifas informadas e situação da liberação no Mercado Pago. Ausência de valor não vira zero. |
| Perguntas | `/comercial/mercado-livre/perguntas` | Leitura e resposta explícita às perguntas dos anúncios. |
| Mensagens | `/comercial/mercado-livre/mensagens` | Conversas pós-venda, resposta e marcação como lida por ação explícita. |
| Contas ML | `/comercial/mercado-livre/contas` | API própria, autorização, acesso remoto e associação autorizada. |
| Configurações | `/comercial/mercado-livre/configuracoes` | Organização dos pedidos, dados para vendas e rotinas opcionais de pedidos, estoque e preços. |

O endereço anterior `/comercial/marketplaces` continua atendendo retornos OAuth e os conectores nativos. Nas contas nativas sem ponte, a ação é identificada como **Buscar e importar pedidos**, pois esse endpoint já executa a importação. Na conta Source, consultar e importar são ações separadas. A importação segue a política de organização salva e pode criar a venda, reservas ou baixas, financeiro e produção; uma opção ainda não salva no formulário não altera essa política.

Em **Contas ML**, a área Mercado Livre permite configurar a API própria e conectar a conta da Elevare3D. Credencial armazenada e validação remota são estados diferentes. A validação de uma conta consulta o vendedor remoto; cadastrar ou associar um nome não autoriza a API. As configurações globais da operação anterior continuam restritas ao perfil financeiro e à aprovação de todas as contas afetadas. Segredo vazio preserva o valor existente somente para o mesmo Client ID.

O operador consulta anúncios, escolhe o produto do Forge e confirma o vínculo. Pedidos podem ser consultados por IDs ou período e entram no mesmo fluxo de conferência e atendimento dos demais canais. Um vínculo não assume o controle do estoque automaticamente.

A conferência de estoque e preço mostra todos os anúncios afetados. O saldo vem do estoque livre do Forge, descontando pedidos pagos ainda não atendidos e conferindo a reserva ou a baixa correspondente. O preço usa o aceite de Mercado Livre para uma unidade; o preço base do catálogo e o acréscimo legado do GC não o substituem. Uma nova conferência é exigida quando estoque, pedidos, vínculos ou condições mudam.

Assumir o controle é uma alteração de responsabilidade, sem envio de quantidade ao Mercado Livre. Depois, atualizar estoque ou preço exige revisar e confirmar a operação. O servidor relê os dados e calcula os valores; o navegador não escolhe quantidades ou preços arbitrários. Uma resposta incerta não repete um envio automaticamente. Anúncios pausados manualmente ou por moderação são preservados.

## Estoque compartilhado e limites

Anúncios de um mesmo User Product e de um mesmo estoque físico anterior precisam de responsabilidade coerente. Variações ou armazéns sem conferência completa, pedidos pendentes na fila anterior e saldos compartilhados com outro canal bloqueiam a transferência. O estoque compartilhado com a Amazon no Integrador deve ser resolvido antes de transferir o produto; o sistema não zera nem altera o outro canal para contornar essa pendência.

Os fluxos antigos de Mercado Livre, Growth e Amazon respeitam os produtos transferidos, inclusive na criação de um novo vínculo concorrente. Os demais produtos continuam no fluxo anterior. O cron antigo continua atendendo aos produtos não transferidos e não assume as contas gerenciadas pelo Forge.

As novas rotinas do Forge começam **desativadas**. O responsável pode habilitar e salvar cada ação em Configurações: consultar/importar pedidos, atualizar estoque e atualizar preços. Também confirma reserva de segurança, tipo de anúncio e intervalo. Estoque exige responsabilidade e vínculos conferidos; preços exigem o aceite de Mercado Livre do produto. Habilitar uma rotina não permite valores arbitrários do navegador nem remove essas pendências.

A execução em segundo plano foi implementada com fila no banco, ticket curto por tarefa e prova privada entre servidores. Não armazena nem reutiliza o JWT do navegador. O worker revalida empresa, responsável, papel, vínculo e revisão da política antes de agir; desativar ou alterar a política invalida tarefas anteriores. Resultado de envio incerto fica bloqueado para conferência explícita, sem repetição automática de uma escrita. A instalação e o funcionamento real do agendamento ainda precisam ser validados na entrega desta versão.

## Entrega e ativação

As migrações 20261102235500, 20261102235600 e 20261102237000 do Forge e as 20261102235500, 20261102237000 e [20261102239000 do Integrador](https://github.com/Guilherme-pedrosa/wedo-ml-integration/blob/0e84ee3/supabase/migrations/20261102239000_forge_private_ml_app.sql) foram aplicadas e verificadas. A última mantém o aplicativo próprio em armazenamento privado por ponte, separado do aplicativo global anterior.

A conexão real da **ELEVARE_3D**, vendedor `3694120570`, foi concluída pelo titular com sua API própria. O acesso remoto e a consulta de anúncios reais foram confirmados no navegador. Nenhuma das contas anteriores foi associada, e essa validação não publicou estoque nem preços. A conta local pode manter o indicador da autorização nativa como pendente: a situação da conexão pelo Integrador vem do vínculo aprovado e das credenciais gerenciadas na origem. A tela recupera esse estado após reabrir, seleciona o vendedor correspondente e não pede uma associação já confirmada.

A ponte publicada está no [commit `0e84ee3` do Integrador](https://github.com/Guilherme-pedrosa/wedo-ml-integration/commit/0e84ee3), com protocolo `2026-11-02.6`. O retorno é para o Forge; sessão expirada preserva esse retorno após o login. A ativação exige identidade, permissão financeira e confirmação entre os servidores. Foram conferidos 283 arquivos de produção da origem para identificar os escritores de ofertas. Os testes isolados cobrem autenticação, permissões, configuração, pedidos, repetição, falhas incertas e concorrência.

A conexão concluída não encerra a migração do modo de trabalho do Integrador para o Forge. O workspace com as nove áreas, publicação, atendimento e rotinas opcionais foi implementado e está em verificação local para a próxima versão do protocolo `2026-11-02.7`; essa versão ainda não foi publicada nem aprovada em teste operacional. As migrations de automação e publicação `20261102240000` a `20261102243000` também dependem do gate e da aplicação desta entrega. Os testes usam dados sintéticos e não publicam anúncios, estoque ou preços reais. A etapa 7 permanece aberta até a revisão operacional do responsável.


## Nova conta Elevare3D

### Primeiro configure o aplicativo

O fluxo começa em **Configurar API da Elevare3D**, dentro do Forge. No [DevCenter oficial](https://developers.mercadolivre.com.br/devcenter), entre na conta proprietária Elevare3D, vincule o cadastro de desenvolvedor e crie ou edite o aplicativo. O retorno OAuth deve ser exatamente `https://integradorwedo.lovable.app/api/public/hooks/ml-oauth`. O fluxo usa Authorization Code, renovação por Refresh Token e PKCE S256. Anúncios, estoque e preços precisam de permissão de publicação e sincronização; a consulta de pedidos e envios precisa da permissão correspondente. Não configure notificações para uma rota sem processamento do Forge.

Cadastre o Client ID e o Client Secret nos campos próprios do Forge. O segredo segue por HTTPS ao Integrador e fica em armazenamento privado da ponte, sem leitura pelo navegador, respostas, logs ou cache de consultas. O formulário limpa o segredo depois da confirmação; deixá-lo vazio preserva uma chave já configurada para o mesmo aplicativo. Salvar credenciais confirma armazenamento, e não valida ainda a autorização no provedor. A conexão da loja permanece bloqueada até essa configuração própria ser confirmada.

As credenciais da Elevare3D não são herdadas do aplicativo global usado pelas outras operações. A autorização inicial e a renovação dos tokens da conta gerenciada usam o mesmo aplicativo da ponte. Alterar o aplicativo não pode deixar tokens ou autorizações pendentes vinculados a outro Client ID. Os parâmetros globais e as contas anteriores continuam com suas credenciais e permissões próprias.

Criar o aplicativo no provedor, aceitar seus termos e concluir CAPTCHA são etapas do titular no Mercado Livre. Depois, o operador volta ao Forge e usa **Conectar Mercado Livre** para autorizar a loja. Referências: [criação do aplicativo](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/crie-uma-aplicacao-no-mercado-livre) e [autenticação e autorização](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao).

Uma aprovação inicial com zero vendedores permite iniciar a autorização sem associar contas antigas. A nova conta gerenciada pelo Forge fica permanentemente fora das rotinas legadas de estoque, preços e vendas do GC, inclusive enquanto a conexão está pendente ou revogada. A autorização usa código e desafio PKCE S256, estado de uso único e recibo com expiração. A prova entre os servidores é privada; apenas seu hash fica no Forge. Credenciais só são ativadas depois da confirmação financeira. Falhas intermediárias podem ser retomadas sem outro cadastro, e uma conta já pertencente a outra operação não é reutilizada.

O operador deve entrar na conta administradora Elevare3D no Mercado Livre antes de autorizar e conferir a conta apresentada pelo provedor. O sistema não acrescenta parâmetros não documentados para forçar a troca de login. A aplicação Mercado Livre deve estar configurada para PKCE; os testes locais verificam a construção S256 e a validação do fluxo, mas não alteram nem comprovam a configuração do painel do provedor.
