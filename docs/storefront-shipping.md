# Frete Elevare3D

O cadastro do produto tem a aba **Embalagem para envio**: comprimento, largura e altura externos em centímetros e peso total embalado em gramas, por unidade vendida. Um cadastro parcial pode ser salvo, mas os quatro valores são necessários para cotar. Peso de filamento e dimensões do modelo não são usados como embalagem.

Em **Loja Elevare3D → Frete pelos Correios**, configure o CEP de origem e os dias adicionais de preparação. O proprietário confirmou origem **75093-630** e autorizou utilizar o mesmo contrato da Selovac. A preparação é somada ao maior prazo de produção dos produtos sob encomenda e ao prazo de transporte.

O carrinho e a página do produto consultam PAC/SEDEX por CEP. O servidor monta volumes com as embalagens cadastradas, soma o peso e empilha as alturas de todas as unidades, abrindo outro volume quando necessário. Não há peso, medidas, preço ou prazo de transporte inventados. Cada serviço precisa ter cotação real para todos os volumes.

## Integração

- `storefront_shipping_quote` confere produtos públicos, preço, quantidade, estoque, embalagem e configuração. Cria um manifesto e uma cotação de15minutos, com cache e limite de consultas.
- `pg_net` envia somente o UUID da cotação a `https://selovacembalagens.com.br/api/public/forge-frete`.
- A ponte Selovac busca o manifesto no RPC fixo `storefront_shipping_manifest('lorace',uuid)` do Forge e consulta as APIs Correios com o contrato existente. As credenciais permanecem no runtime da Selovac.
- `storefront_shipping_quote_status` recebe preço e prazo válidos, soma preparação/produção e devolve as opções. Erro ou ausência de resposta não produz frete estimado.
- `begin_storefront_checkout` exige a cotação, o serviço e o valor esperado, revalida o carrinho/CEP/configuração e grava o valor confirmado no pedido. Alterações de embalagem, preço, quantidades e destino exigem nova cotação.
- Um pedido já aceito mantém sua cotação no reenvio idêntico, inclusive após expiração, para recuperar respostas perdidas sem duplicar pedido ou pagamento.

O frete funciona independentemente da conexão Mercado Pago. O pagamento continua dependendo da configuração da conta recebedora, adiada pelo proprietário.

## Verificação

`npm run test:lorace` inclui os cenários de embalagem e cotação: permissões, empresa, privacidade dos componentes, montagem de volumes, transporte HTTPS, respostas inválidas, cache, prazo, alteração de destino, adulteração do frete e reenvio do checkout. A ponte Selovac possui testes próprios e valida o manifesto antes de utilizar a resposta em cache.
