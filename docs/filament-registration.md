# Cadastro único de filamento e bobina

Em Bobinas e filamentos, Cadastrar bobina abre um formulário único. O botão Novo filamento e bobina de Materiais e insumos abre o mesmo fluxo. Não é necessário criar um grupo de material antes.

Para um filamento novo, informe material, cor, marca opcional, filamento restante e custo por kg. Material/cor, bobina física e entrada de estoque são salvos juntos. A identificação da bobina e o código da cor podem ser gerados. Localização, AMS, capacidade original e observação ficam em detalhes opcionais.

O peso pode ser informado diretamente, sem carretel, ou calculado pelo peso bruto menos a tara. A capacidade original não é uma entrada: uma bobina de capacidade 1.000 g, pesando 1.100 g com carretel de 200 g, recebe 900 g de filamento no estoque.

Para filamento existente, o padrão identifica uma bobina já contabilizada. Somar esta bobina ao estoque deve ser marcado somente quando o saldo ainda não foi lançado, como em uma nova entrada. Itens em kg recebem a conversão dos gramas. Pesagens e trocas de posição não duplicam saldo.

O RPC register_filament_spool executa tudo na mesma transação, preserva a empresa e a ordem de bloqueios e retorna um comprovante idempotente. Falhas de rótulo ou AMS revertem também o material e a entrada. Repetir a mesma operação após falha de conexão não duplica cadastro nem movimento. O custo de uma entrada deve ser explícito; zero é aceito e campo vazio não representa material gratuito.

A suíte test-unified-filament-registration.mjs roda em PostgreSQL isolado e integra test:operations. Ela cobre saldo em g/kg, entrada líquida, associação sem entrada, custos, repetição, permissões, rollback e geração de rótulos. A conferência visual publicada não registra bobinas de teste no estoque real.
