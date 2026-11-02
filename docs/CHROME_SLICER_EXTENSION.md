# Extensão de fatiamento do Forge

O botão da extensão abre **Novo Produto → Produto e preço** no Forge. Ao abrir a extensão numa página de modelo do MakerWorld, o link é preenchido nesse mesmo cadastro. A consulta do link e o fatiamento só começam por ação do operador. A extensão não baixa um projeto privado automaticamente nem acessa a conta Bambu.

Escolha o STL ou 3MF no cadastro e use **Fatiar neste computador**. O conector executa o motor do Bambu Studio oficial instalado em segundo plano, devolve o 3MF fatiado e encerra. Não é necessário abrir o projeto na janela do Bambu Studio. **Usar no cadastro** importa esse arquivo resultante, com seu hash, placas e filamentos; a composição segue no mesmo formulário. O salvamento do produto continua explícito.

O popup verifica a ligação entre extensão e conector. A página precisa também poder falar com a extensão: as origens exatas aceitas são `https://elevare3d.com.br`, `https://elevare3d.lovable.app` e o preview deste projeto. Se o popup está conectado e a página não, atualize o pacote na mesma pasta, clique em **Recarregar** na extensão em `chrome://extensions`, atualize a página do Forge e use **Verificar extensão novamente**. Não é necessário reinstalar um conector saudável para essa atualização. A fila de fatiamento da empresa é uma opção separada e só é consultada quando escolhida; a indisponibilidade dessa fila não informa o estado da extensão local.

A versão 1.0.2 acrescenta A2L ao conector nativo. Para essa atualização, execute o instalador do pacote novo e recarregue a extensão; instalações antigas continuam atendendo à A1 até a atualização.

## Instalação

1. Baixe `/downloads/forge-slicer-extension.zip` no Forge e extraia o pacote para uma pasta permanente.
2. Requisitos atuais: Windows, Node.js 22+ e Bambu Studio oficial **2.8.2.61**. Confira o instalador com `node install-slicer-extension.mjs --review`; esse comando apenas descreve os caminhos e as duas chaves de registro do usuário.
3. Execute `node install-slicer-extension.mjs`. O instalador verifica o motor offline, protege a pasta local e registra o conector do usuário no Chrome e Edge. Não cria serviço, tarefa de inicialização ou servidor de rede.
4. Abra `chrome://extensions`, ative o modo do desenvolvedor, escolha **Carregar sem compactação** e selecione a pasta extraída do pacote, a mesma que contém `manifest.json`. No Edge, use `edge://extensions`.
5. Use **Verificar conexão** na extensão e abra o cadastro no Forge.

A identificação fixa é `lkalcgppeejlaioplgipmmgdcpncofck`. A chave pública do manifesto mantém essa identidade nas instalações locais; o conector só aceita essa extensão. O LEIA-ME do pacote também contém os passos de remoção, limitados ao conector e às chaves HKCU criadas por ele.

## Perfil e recursos

Os perfis de simulação validados são **A1 e A2L / bico 0,4 mm / PLA / camada 0,20 mm**. O cadastro oferece apenas os modelos existentes na empresa, agrupando máquinas iguais. O modelo já escolhido na precificação é reaproveitado. Um STL usa orientação e organização automáticas. Um projeto 3MF completo preserva suas placas, cópias, slots e cores PLA; a validação recusa mudanças inesperadas. Outro modelo ou material exige um 3MF fatiado no perfil correspondente. Projetos multicoloridos usam a estratégia presente no 3MF: trocas automáticas com purga e torre ou placas preparadas com cores separadas. O sistema não transforma automaticamente uma geometria multicolorida em peças separáveis. A versão 1.0.2 verifica também o modelo nos metadados de saída; não basta alterar o nome do perfil.

A extensão usa Manifest V3 e não mantém consultas, alarmes ou processamento ocioso. O processo nativo abre por solicitação, aceita uma simulação por vez, roda em prioridade abaixo do normal e encerra ao concluir, cancelar ou desconectar. O trabalho tem limite de dez minutos. O motor instalado não suporta `--threads 2`; a versão atual não promete um limite de dois núcleos.

Os arquivos passam localmente entre Forge, extensão e conector em blocos de 384 KiB, com confirmação, limites de 64 MiB e SHA-256 de origem e resultado. Não há sessão Supabase, senha, conta Bambu ou credencial no pacote. O conector só recebe os bytes escolhidos, sem comandos, URLs para baixar ou caminhos arbitrários do computador. A consulta de disponibilidade abre uma sessão curta, sem fatiar.

## Purga, torre e totais

O custo usa o **consumo total informado pelo fatiador**, por cor e placa. Para a versão oficial validada, `slice_info.config → filament.used_g` e `result.json → total_used_g` vêm do volume total, incluindo torre e flush reconhecidos pelo motor. O tempo total é `prediction` / `total_predication`. Somar os mesmos consumos novamente duplicaria o custo. O worker cruza os totais do XML e do JSON antes de entregar o arquivo.

`main_used_g` e `main_predication` não são os totais de produção: excluem partes auxiliares. A diferença entre peso total e principal não identifica exclusivamente a torre. A presença de `need_ams` em metadados MakerWorld também não comprova quais perdas estão incluídas. Rotinas físicas adicionais que o motor não contabiliza continuam exigindo referência de produção; estimativa de fatiamento não é consumo efetivamente medido.

Fontes primárias da versão usada: [volume total, torre e flush](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/GCode/GCodeProcessor.cpp#L1290), [exportação dos totais e dos valores principais](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/BambuStudio.cpp#L6705), [protocolo Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [ciclo de vida da extensão](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Validação

`node scripts/test-slicer-extension.mjs` confere identidade, origens, mensagens e cancelamento. `node scripts/test-slicer-native-host.mjs --real-engine` confere protocolo binário, integridade, travas, encerramento e o fatiamento real de um cubo. Os testes React cobrem disponibilidade, envio, download, hashes, cancelamento e uso do 3MF resultante no cadastro. A instalação real com ACL e registro depende de uma sessão Windows com acesso à pasta privada; a execução no AppContainer do Codex não substitui essa etapa.


Em 02/11/2026, o conector instalado foi exercitado pelo protocolo binário real, com download dos blocos e conferência de SHA-256: cubo A1, 3,63 g / 1.351 s; cubo A2L, 3,57 g / 1.355 s; projeto sintético de duas cores na A2L, 60,92 g / 12.734 s. Cada processo encerrou com código zero e sem arquivos de trabalho restantes. Esses exemplos validam o percurso técnico; não substituem o fatiamento do produto real do operador.
