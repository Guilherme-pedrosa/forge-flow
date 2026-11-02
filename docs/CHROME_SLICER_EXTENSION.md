# Extensão de fatiamento do Forge

O botão da extensão abre **Novo Produto → Produto e preço** no Forge. Ao abrir a extensão numa página de modelo do MakerWorld, o link é preenchido nesse mesmo cadastro. A consulta do link e o fatiamento só começam por ação do operador. A extensão não baixa um projeto privado automaticamente nem acessa a conta Bambu.

Escolha o STL ou 3MF no cadastro e use **Fatiar neste computador**. O conector executa o Bambu Studio oficial instalado, devolve o 3MF fatiado e encerra. **Usar no cadastro** importa esse arquivo resultante, com seu hash, placas e filamentos; a composição segue no mesmo formulário. O salvamento do produto continua explícito.

## Instalação

1. Baixe `/downloads/forge-slicer-extension.zip` no Forge e extraia o pacote para uma pasta permanente.
2. Requisitos atuais: Windows, Node.js 22+ e Bambu Studio oficial **2.8.2.61**. Confira o instalador com `node install-slicer-extension.mjs --review`; esse comando apenas descreve os caminhos e as duas chaves de registro do usuário.
3. Execute `node install-slicer-extension.mjs`. O instalador verifica o motor offline, protege a pasta local e registra o conector do usuário no Chrome e Edge. Não cria serviço, tarefa de inicialização ou servidor de rede.
4. Abra `chrome://extensions`, ative o modo do desenvolvedor, escolha **Carregar sem compactação** e selecione a pasta extraída do pacote, a mesma que contém `manifest.json`. No Edge, use `edge://extensions`.
5. Use **Verificar conexão** na extensão e abra o cadastro no Forge.

A identificação fixa é `lkalcgppeejlaioplgipmmgdcpncofck`. A chave pública do manifesto mantém essa identidade nas instalações locais; o conector só aceita essa extensão. O LEIA-ME do pacote também contém os passos de remoção, limitados ao conector e às chaves HKCU criadas por ele.

## Perfil e recursos

O perfil de simulação validado nesta versão é **A1 / bico 0,4 mm / PLA / camada 0,20 mm**. Um STL usa orientação e organização automáticas. Um projeto 3MF completo preserva suas placas, cópias, slots e cores PLA; a validação recusa mudanças inesperadas. Outro modelo ou material exige um 3MF fatiado no perfil correspondente. Selecionar AMS ou separar placas exige o perfil de produção correto.

A extensão usa Manifest V3 e não mantém consultas, alarmes ou processamento ocioso. O processo nativo abre por solicitação, aceita uma simulação por vez, roda em prioridade abaixo do normal e encerra ao concluir, cancelar ou desconectar. O trabalho tem limite de dez minutos. O motor instalado não suporta `--threads 2`; a versão atual não promete um limite de dois núcleos.

Os arquivos passam localmente entre Forge, extensão e conector em blocos de 384 KiB, com confirmação, limites de 64 MiB e SHA-256 de origem e resultado. Não há sessão Supabase, senha, conta Bambu ou credencial no pacote. O conector só recebe os bytes escolhidos, sem comandos, URLs para baixar ou caminhos arbitrários do computador. A consulta de disponibilidade abre uma sessão curta, sem fatiar.

## Purga, torre e totais

O custo usa o **consumo total informado pelo fatiador**, por cor e placa. Para a versão oficial validada, `slice_info.config → filament.used_g` e `result.json → total_used_g` vêm do volume total, incluindo torre e flush reconhecidos pelo motor. O tempo total é `prediction` / `total_predication`. Somar os mesmos consumos novamente duplicaria o custo. O worker cruza os totais do XML e do JSON antes de entregar o arquivo.

`main_used_g` e `main_predication` não são os totais de produção: excluem partes auxiliares. A diferença entre peso total e principal não identifica exclusivamente a torre. A presença de `need_ams` em metadados MakerWorld também não comprova quais perdas estão incluídas. Rotinas físicas adicionais que o motor não contabiliza continuam exigindo referência de produção; estimativa de fatiamento não é consumo efetivamente medido.

Fontes primárias da versão usada: [volume total, torre e flush](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/GCode/GCodeProcessor.cpp#L1290), [exportação dos totais e dos valores principais](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/BambuStudio.cpp#L6705), [protocolo Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [ciclo de vida da extensão](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Validação

`node scripts/test-slicer-extension.mjs` confere identidade, origens, mensagens e cancelamento. `node scripts/test-slicer-native-host.mjs --real-engine` confere protocolo binário, integridade, travas, encerramento e o fatiamento real de um cubo. Os testes React cobrem disponibilidade, envio, download, hashes, cancelamento e uso do 3MF resultante no cadastro. A instalação real com ACL e registro depende de uma sessão Windows com acesso à pasta privada; a execução no AppContainer do Codex não substitui essa etapa.
