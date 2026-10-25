# Identidade de execução e ficha aprendida

Os identificadores importados em `product_print_sources` e
`product_print_plates` representam o arquivo, perfil e placa da revisão ativa.
Escolher uma impressão não altera esses campos.

`bind_file_plate_execution(p_plate_id,p_task_id,p_file_sha256)` exige uma
confirmação explícita de que a execução usou aquele arquivo/placa. O SHA256
deve coincidir com o da fonte ativa. A associação registra dispositivo,
modelo/perfil/índice observados, fingerprint da revisão, autor e auditoria.
O retorno continua sendo o UUID da placa. A RPC não configura consumo, cria
perfil automático, lança estoque ou contabiliza a impressão.

`bind_product_print_plate` mantém a assinatura antiga para identidades
importadas exatas, placas sem identidade prévia e confirmações vigentes.
Uma fonte local ou perfil divergente exige a confirmação com SHA256.
Depois dela, `configure_bambu_production` e `account_bambu_production`
continuam sendo as APIs de configuração e apuração. A identidade da execução
fica congelada no registro. Mudar o arquivo exige nova conferência.

`product_plate_learning(p_plate_id)` lê a referência atual, quando existe.
`product_piece_spec` e o BOM usam essa referência automaticamente somente
quando a placa tem um único SKU físico confirmado e nenhuma peça desconhecida.
Precisam existir associação vigente, apuração concluída e qualidade de todas
as saídas decidida. São consideradas apenas as unidades aprovadas; nenhuma
média atravessa perfis Bambu diferentes. Sem dados confiáveis, permanece a
estimativa anterior. Uma ficha manual sempre tem prioridade.

A resposta aprendida usa `source: "bambu"` e inclui `learned_reference`
com quantidade de amostras/unidades, perfil exato, hash e atualização. A leitura
é calculada sobre registros congelados, sem regravar fichas ou históricos.
Nenhum dos registros antigos recebe associação por migração.

Na interface, apresentar as identidades do arquivo e da execução separadamente.
O checkbox “Esta impressão foi feita com este arquivo/placa” deve anteceder
a RPC com SHA256; não pode ser marcado automaticamente. Após apuração ou
qualidade, invalidar as consultas de placas, `piece_spec`, BOM e estoque.

Teste: `node scripts/test-bambu-execution-learning.mjs`.
