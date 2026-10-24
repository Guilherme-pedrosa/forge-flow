# Administração do site Elevare3D

A loja tem edição autenticada em `https://loja-elevare3d.lovable.app/admin`. O login usa o e-mail e a senha das contas owner/admin da empresa da loja, já existentes no Forge. A sessão é feita no próprio domínio da loja; tokens não são copiados entre as abas.

O conteúdo público é lido por `storefront_site`. Rascunhos e histórico ficam em `erp_private`, sem acesso direto de visitantes ou de usuários comuns. As rotinas administrativas conferem usuário, empresa e papel no servidor.

O editor salva rascunhos e publica uma cópia separada. Cada alteração exige a revisão esperada; duas sessões não sobrescrevem o trabalho uma da outra silenciosamente. O histórico pode ser restaurado como rascunho para revisão antes de publicar.

As imagens PNG/JPG/WebP/AVIF/GIF de até 5 MB ficam em uma tabela privada do CMS. O envio exige owner/admin e valida o conteúdo real do arquivo. A leitura pública só é liberada para imagens referenciadas na versão publicada; imagens novas de rascunho ficam restritas aos administradores do canal. Os endereços internos seguem `/cms-media/<uuid>` e são resolvidos pela loja. Não há dependência de permissões ou buckets do Storage.

Produtos, custos, preços, componentes e estoque continuam no cadastro comercial do Forge. O painel administra a apresentação da loja e suas páginas; não cria permissões financeiras nem altera os dados comerciais.

Validação: `node scripts/test-storefront-cms.mjs` cobre papéis, empresas, visitantes, rascunho privado, publicação, histórico, restauração, concorrência, validação do documento e acesso às imagens privadas. O comando também integra `test:lorace` da CI.
