# Fatiador local do Forge

O navegador envia STL/3MF para uma fila privada da empresa. O worker local executa o Bambu Studio oficial, devolve o 3MF fatiado e as estimativas nativas de tempo/filamento por placa. O componente `SlicingDialog` entrega um `File` validado para o fluxo de importação existente. Esse fluxo decide quando aplicar a composição ao produto.

## Instalação no Windows

1. Aplicar a migration `20261024200000_slicer_queue.sql` e publicar o frontend que usa `SlicingDialog`.
2. No Forge, um proprietário/administrador gera o arquivo de conexão no diálogo de simulação. O RPC autenticado é `create_slicer_worker({p_name: 'Fatiador local'})`. Retorna `worker_id` e `worker_token` uma única vez; o banco guarda somente SHA256 do token. Não copiar o token para chat, argumentos ou logs.
3. No repositório, executar `npm run build:worker`. O pacote autocontido fica em `dist/worker`.
4. No computador com o Bambu Studio oficial 2.8.2.61 e Node.js 22+, executar:

```powershell
powershell -NoProfile -File .\dist\worker\setup-forge-slicer.ps1 -ConnectionFile 'C:\caminho\forge-slicer-conexao.private.json' -Start -RegisterStartup
```

Se o Node não estiver no PATH, passar `-NodePath 'C:\caminho\node.exe'`. A instalação protege `%LOCALAPPDATA%\Elevare3D\ForgeSlicer` por ACL (usuário atual, SYSTEM e administradores), resolve os perfis oficiais A1 0,4 / Generic PLA / 0,20 mm, grava os hashes e fatia um cubo sintético offline para confirmar a versão real do motor. O launcher oficial não expõe ProductVersion no Windows.

O worker e a tarefa de inicialização rodam ocultos e sem elevação. Para iniciar novamente, executar o `start-forge-slicer.ps1` dessa pasta. Os logs locais mostram somente IDs de simulação e falhas sem credenciais. Depois da instalação, remover a cópia baixada do arquivo de conexão. Para revogar o acesso, usar `revoke_slicer_worker({p_worker: '<UUID>'})` com conta de proprietário/administrador.

## Isolamento e resultados

- Worker usa somente os RPCs da fila, autenticados por UUID + segredo e lease por tarefa. Não recebe sessão de usuário nem acesso a clientes, vendas ou estoque.
- Arquivos de até 64 MiB, blocos binários de 384 KiB (512 KiB em base64), SHA256 confirmado antes de enfileirar. Até três tarefas ativas por usuário.
- Origem apagada ao concluir/cancelar/falhar. Saídas bruta e validada ficam privadas por até 48 horas desde o envio; metadados, hashes e métricas permanecem. Limpeza horária pelo pg_cron e também ao consultar/criar/atribuir tarefas.
- O EXE usa argumentos fixos sem shell, janela oculta, datadir por tarefa e limite de dez minutos. Não contém comandos de impressão, conexão a impressora ou conta Bambu.
- Scripts de pós-processamento, referências externas, caminhos ZIP perigosos, DTDs e arquivos fora dos limites são recusados antes do fatiamento.
- Duas falhas conhecidas de escape XML do CLI são corrigidas somente na saída oficial: `compatible_printers` e `print_extruder_variant`, com valores exatos dos perfis A1. Outros erros XML falham a tarefa. O arquivo enviado pelo usuário nunca é reparado. Hashes dos membros de geometria e G-code permanecem idênticos; o bruto é guardado com seu próprio SHA.
- `source_sha256`/`stats.input_sha256` identificam o arquivo enviado. `result_sha256`/`stats.output_sha256` identificam o 3MF final retornado ao importador. Eles não são intercambiáveis.
- As métricas são estimativas do fatiador. Nenhuma operação da fila altera saldo, consumo real ou ordens de produção.

## Verificação

`npm run test:slicer` cobre permissões, tenants, leases, idempotência, corrupção, expiração, ZIP/XML, integridade dos membros e isolamento da execução nativa. `npm test` cobre também o diálogo e a conferência do hash do download.

Prova opcional completa com o EXE instalado (banco PGlite descartável e cubo sintético):

```powershell
$env:FORGE_TEST_BAMBU_ENGINE = 'C:\Program Files\Bambu Studio\bambu-studio.exe'
node scripts/test-slicer-queue.mjs
Remove-Item Env:FORGE_TEST_BAMBU_ENGINE
```

Essa prova faz upload → fila → worker → EXE real → download do 3MF validado, sem conta ou dados do ERP. A validação no endpoint publicado deve ser feita após a instalação do worker e integração do diálogo.
