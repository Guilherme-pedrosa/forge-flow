# Projetos sintéticos de regressão

`two-plate-native-mono.3mf` contém geometria de cubos sintéticos e metadados completos exportados pelo Bambu Studio 02.08.02.61. A placa 1 tem duas cópias de Part A (object 2); a placa 2 tem três cópias de Part B (object 4). Não contém dados de negócio ou impressoras.

O worker antigo, com `--orient1 --arrange1`, juntava as cinco cópias numa placa. `merged-output-model-settings.xml` é a configuração real dessa saída incorreta, usada como regressão negativa. Com orientação e organização desabilitadas, o CLI preserva placas/instâncias e retorna métricas separadas.

`two-plate-native-color.3mf` foi criado pelo CLI a partir de dois STL e dois presets PLA distintos: duas cópias vermelhas na placa 1, três verdes na placa 2. `three-plate-two-color.3mf` acrescenta uma terceira peça com quatro cópias na segunda linha de placas. `nonsequential-ids-source.3mf` mantém a composição de duas cores, alterando somente os IDs internos para 101/709; o CLI os renumera para 2/4. A conferência usa nome, geometria e slot para reconhecer as mesmas peças sem depender desses IDs.

O fatiamento de um projeto 3MF conserva os filamentos PLA embutidos. O CLI oficial trata `--load-filaments` como substituição dos slots e pode mapear vários slots para um único material quando recebe um preset único. Referências: [manual CLI](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage), [transformações e mapeamento no código oficial](https://github.com/bambulab/BambuStudio/blob/master/src/BambuStudio.cpp).
