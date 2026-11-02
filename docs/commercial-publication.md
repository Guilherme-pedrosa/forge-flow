# Descrição e medidas para a Elevare3D

O cadastro importado gera texto de venda em português usando nome, categoria e os materiais/cores efetivamente confirmados no cálculo. Não copia a descrição técnica do autor: pedidos de boost, economia de filamento, configurações de impressão e instruções do fatiador ficam fora do texto para o cliente. A fonte original, autor e licença continuam preservados em `external_import`; no 3MF, o arquivo original continua no fluxo técnico.

O gerador é local e determinístico, sem chamadas a tradutores ou IA. Nomes comuns têm tradução conhecida; um nome desconhecido permanece identificado como nome do modelo, sem tradução inventada. O texto é editável. Alterações manuais, inclusive apagar o campo, impedem substituição automática. **Reescrever para loja** é a escolha explícita para gerar novamente.

As cores da oferta vêm dos filamentos escolhidos e confirmados no ERP, não da quantidade padrão do cadastro ou de um perfil público ainda não conferido. As medidas são da peça pronta. A disposição dos objetos na placa e as dimensões de uma caixa de envio não determinam o tamanho do produto montado.

**Medidas da peça** aparece tanto no cadastro quanto na publicação. A tela usa cm e grava mm em `products.commercial_presentation`. Medida não conhecida fica vazia/null; zero não representa uma medida ausente. Textos gerados ainda intactos podem atualizar somente a frase das medidas, preservando cores e material previamente confirmados. Texto manual permanece intacto.

**Embalagem para envio** reúne comprimento, largura, altura e peso total embalado. O formulário de publicação pede os quatro dados antes de publicar com cálculo de frete e salva no cadastro canônico do produto. A descrição e as medidas da peça também podem ser preenchidas nessa tela, sem voltar ao cadastro. O peso previsto de filamento não é usado como peso embalado.

A apresentação comercial é gravada junto com o produto pelo RPC existente, preservando o payload e a identidade das requisições. Repetir uma requisição aceita não substitui edições comerciais posteriores. A mudança não altera receita, estoque, custo aceito ou preço por canal. O CHECK também valida atualizações diretas sob as regras de acesso da empresa.

Validação: `npm run test:commercial-publication`, testes de banco descartável para persistência/replay/permissões, e regressões de importação, precificação, texto manual e publicação. Foram mantidos casos com três cores, material e dimensões parciais. As medidas reais dos produtos dependem da medição da operação; nenhum tamanho foi inventado nos testes ou na atualização do catálogo.
