# Autenticação do Forge & Flow

Revisão estática do código e das migrations em 2 de novembro de 2026. A identidade é gerenciada pelo Supabase Auth; o perfil associa o usuário a uma empresa, e o banco aplica permissões por empresa e papel. Esta revisão não confirma a configuração nem as versões publicadas no Supabase.

## Componentes e fluxo das requisições

1. [Login](../src/pages/auth/Login.tsx#L18) envia e-mail e senha a `supabase.auth.signInWithPassword`. [Cadastro](../src/pages/auth/Signup.tsx#L18) usa `signUp` com retorno ao domínio atual. O cadastro orienta confirmar o e-mail; a exigência efetiva depende da configuração do Supabase Auth.
2. O [cliente Supabase](../src/integrations/supabase/client.ts#L6) usa URL e chave publicável do projeto. O SDK gerencia a sessão com token de acesso e token de renovação, persiste a sessão e renova o token automaticamente.
3. O [AuthProvider](../src/contexts/AuthContext.tsx#L62) observa eventos de autenticação, recupera a sessão e consulta `profiles` pelo `user_id`. O perfil informa `tenant_id`, que identifica a empresa. A espera por sessão/perfil é limitada a 15 segundos, com tentativa recuperável. Erro de consulta não é tratado como perfil inexistente.
4. [AuthAccess](../src/App.tsx#L62) aguarda a confirmação do perfil antes de montar as telas privadas. Sem sessão, encaminha para login; com sessão e perfil ausente, para configuração da empresa. O [onboarding](../src/pages/onboarding/SetupTenant.tsx#L30) chama `bootstrap_tenant` para criar empresa, perfil e papel inicial.
5. As telas usam o mesmo cliente para consultas PostgREST, RPCs e Edge Functions. O SDK inclui a credencial da sessão nas chamadas autenticadas. No banco, `auth.uid()` identifica o usuário; as políticas RLS filtram os registros da empresa. As funções [erp_can_write e erp_private.actor](../supabase/migrations/20260913010000_erp_integrity.sql#L6) verificam os papéis autorizados para alterações operacionais e financeiras. Bloquear uma tela no React não substitui essas verificações do servidor.
6. Na troca de usuário ou saída, o provider cancela consultas, limpa o cache e invalida leituras antigas para impedir que o perfil anterior reapareça. A [saída](../src/contexts/AuthContext.tsx#L137) usa `signOut({ scope: "local" })`, encerrando a sessão local; não solicita saída global de todos os dispositivos.

## Senhas, chaves e tokens

| Credencial | Tratamento no código |
| --- | --- |
| Senha do usuário | Fica no estado do formulário e é enviada ao Supabase Auth. O aplicativo não a grava em `localStorage` nem em uma tabela de senhas própria. A criação/alteração administrativa também encaminha a senha ao Supabase Auth pelo servidor. |
| Chave publicável Supabase | `VITE_SUPABASE_PUBLISHABLE_KEY` é incluída no frontend e identifica o projeto; não concede privilégios de administrador. O acesso aos dados depende da sessão, RLS e permissões dos RPCs. |
| Sessão do navegador | [brokeredPreviewStorage](../src/integrations/supabase/previewAuthStorage.ts#L6) usa `localStorage` normalmente. Em hosts de preview reconhecidos e embutidos, também compartilha a sessão por `postMessage` com origens autorizadas do editor Lovable. Valida a origem das respostas e usa `targetOrigin` explícito, com fallback local. Esses tokens permanecem acessíveis ao JavaScript da página; não são cookies HttpOnly. |
| Service role Supabase | As Edge Functions leem `SUPABASE_SERVICE_ROLE_KEY` do ambiente servidor. Ela ignora RLS; os handlers precisam validar identidade, empresa e papel antes de agir. Nunca deve ser criada como variável `VITE_`. |
| Bambu Cloud | A [Edge Function](../supabase/functions/bambu-cloud-sync/index.ts#L75) recebe as credenciais de login e guarda o token retornado pelo provedor. Apesar do nome `access_token_encrypted`, o [valor atribuído](../supabase/functions/bambu-cloud-sync/index.ts#L129) é o token original, sem criptografia de aplicação nesse caminho. A [migration de proteção](../supabase/migrations/20260913014000_erp_guards.sql#L56) remove a leitura dessa coluna e as escritas diretas dos clientes autenticados. Isso não comprova como a infraestrutura protege o armazenamento físico. |
| Marketplaces e pagamentos | Credenciais ficam em tabelas sem leitura direta para clientes `anon/authenticated`. A [documentação Shopee](shopee-connector.md) descreve segredos no servidor, renovação serializada e persistência do par de tokens; a [integração da loja](lorace-integration.md) descreve Access Token e segredo do webhook Mercado Pago. |
| Fatiador local | Usa um segredo próprio, separado da sessão do usuário e da conta Bambu. O [RPC de criação](../supabase/migrations/20261024200000_slicer_queue.sql#L114) exige proprietário/administrador, retorna o segredo uma vez e guarda somente SHA256. Os RPCs do worker validam UUID, segredo e lease da tarefa. Instalação e revogação estão em [SLICER_WORKER.md](SLICER_WORKER.md). |

## Operações administrativas e endpoints públicos

[create-user](../supabase/functions/create-user/index.ts#L17) valida a sessão com `getUser`, busca a empresa e exige `owner/admin` antes de usar a API administrativa. Valida a senha com 8 a 128 caracteres, cria o usuário e provisiona perfil/papel; se o provisionamento falhar, tenta remover a identidade criada.

[set-user-password](../supabase/functions/set-user-password/index.ts#L16) também exige `owner/admin`, verifica que o alvo pertence à mesma empresa e pretende permitir alteração da senha de um proprietário apenas por outro proprietário.

O [config.toml](../supabase/config.toml) mantém verificação JWT para os handlers de marketplace. `lorace-payments` tem `verify_jwt=false` porque atende checkout público e webhook: o [handler](../supabase/functions/lorace-payments/index.ts#L28) verifica a assinatura do webhook e exige sessão/papel para a ação administrativa de conexão.

## Observações da revisão

- **Alteração de senha de proprietário:** a [consulta dos papéis do alvo](../supabase/functions/set-user-password/index.ts#L59) ignora o campo `error`. Se essa consulta falhar, `targetIsOwner` fica indefinido e a operação pode prosseguir para um administrador, contrariando a restrição pretendida. A consulta deve rejeitar a operação quando falhar. Nenhuma alteração de autenticação foi incluída na correção de precificação.
- **Validação de senha na interface:** [Usuarios.tsx](../src/pages/configuracoes/Usuarios.tsx#L97) habilita criação a partir de seis caracteres; o backend exige oito. O servidor rejeita a senha curta, mas a interface permite uma tentativa que vai falhar.
- **Estado publicado desconhecido:** arquivos e migrations demonstram a implementação pretendida. Não comprovam migrations aplicadas, Edge Functions publicadas, confirmação de e-mail, políticas adicionais ou segredos disponíveis no ambiente real.

A [auditoria financeira e de acesso](finance-auth-audit.md) registra as correções anteriores de isolamento de sessão. Os testes de [auth-session-isolation](../src/test/auth-session-isolation.test.tsx) cobrem troca de usuário, saída, concorrência, timeout e recuperação de consultas.


## Ponte com o IntegradorML

Contas explicitamente associadas ao Integrador usam um caminho adicional: a tela obtém o token de acesso da sessão atual e o envia por HTTPS ao endpoint fixo do Integrador, sem cookies, redirecionamentos ou persistência desse token na ponte. O servidor consulta o Supabase Auth do Forge e os RPCs de empresa e permissões; em seguida, confere o vínculo aprovado na origem e no Forge. Alterações financeiras exigem o papel correspondente, e alterações globais exigem o escopo completo. A aprovação é revalidada durante operações remotas. O identificador público da ponte não é uma credencial.

Access token e refresh token do Mercado Livre continuam nas tabelas protegidas do Integrador e são renovados pelo processo existente. Não vão para o navegador, a extensão ou a tabela de credenciais nativa do Forge. O banco impede criar credenciais ou estados OAuth nativos para uma conta cujo proprietário é o Integrador, inclusive no retorno de uma autorização antiga. Contas nativas não associadas continuam no fluxo próprio. Ver [componentes, operação e limites](INTEGRADOR_ML.md).


A autorização de uma conta nova começa no Forge e usa o callback já registrado no Integrador, `/api/public/hooks/ml-oauth`. Estado e verificador PKCE ficam no servidor; a URL de retorno carrega apenas tentativa e recibo de curta duração. A ativação requer uma sessão Forge atual, o mesmo usuário/empresa da tentativa e uma prova privada Source→Forge. Um cadastro local pendente só é reaproveitado quando selecionado, sem credenciais próprias, autorização concorrente ativa ou histórico de vendedor desconhecido. O login preserva um retorno local validado, sem aceitar endereços externos.
