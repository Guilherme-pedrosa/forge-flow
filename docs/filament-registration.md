# Cadastro de filamentos por material e cor

**Operação → Filamentos → Novo filamento** abre o cadastro por material, cor e marca. **Materiais e insumos → Novo filamento** abre o mesmo formulário na própria tela. O nome e o código interno da cor são gerados; nome personalizado, SKU, diâmetro e observações ficam nos detalhes opcionais.

O filamento pode ser cadastrado com saldo zero, antes de qualquer compra. Para lançar o saldo inicial, informe a quantidade total em kg ou g e seu custo por kg. Novos cadastros são armazenados em g; a conversão do custo é feita uma vez. Uma unidade já cadastrada é preservada. O cadastro não cria bobina física, capacidade ou tara.

**Editar** permite corrigir o saldo disponível, inclusive para zero, e o custo médio. Alterações apenas de identificação não reenviam saldo nem custo. Ajustes de quantidade conferem o saldo anterior mostrado na tela: se uma compra entrou durante a edição, o banco pede nova conferência. A tela de Movimentações aplica a mesma proteção na conferência de uma ou várias cores, com gravação atômica.

Uma compra recebida soma a quantidade ao estoque e atualiza o custo médio ponderado: `(saldo anterior × custo anterior + custo da entrada) ÷ novo saldo`. O custo da entrada considera a distribuição das despesas e descontos do pedido. Repetir o recebimento não duplica saldo. Os leitores de filamentos, composição e precificação são atualizados após compras e ajustes manuais. Custo ainda não informado permanece pendente na precificação; zero só representa aquisição gratuita quando há confirmação desse recebimento.

O cadastro principal usa `save_inventory_catalog`, com o mesmo identificador na repetição após falha de conexão. **Controle de bobinas e localização (opcional)** mantém a pesagem e a localização existentes; ele só é carregado quando aberto. Esse controle é independente do cadastro diário por cor.

`scripts/test-simple-filament-registration.mjs` usa PostgreSQL isolado e cobre cadastro sem bobina, g/kg, ajustes, compras, custo médio, concorrência e repetição. Os testes de interface conferem os dois pontos de cadastro e a atualização do custo na calculadora após um recebimento.
