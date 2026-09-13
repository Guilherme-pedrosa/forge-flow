# Revisão financeira, compras e acesso

## Problemas corrigidos

| Fluxo | Falha anterior | Comportamento implementado |
| --- | --- | --- |
| Pagar/receber | Quitação total sem conta, sem extrato; cancelados ainda podiam ser pagos; vencidos dependiam do status persistido | Baixa parcial/total com banco obrigatório, data válida até hoje, saldo remanescente e operação SQL transacional; histórico das baixas; atraso calculado pela data |
| Gestão de títulos | Exclusão física sem confirmação, risco de apagar histórico | Cancelamento explícito de títulos manuais sem baixa; títulos originados de compra/pedido são gerenciados na origem; edição com versão `updated_at`, preservando autor original |
| Classificação de compras | Serviços sem vínculo ao estoque não tinham caminho para resolver a pendência da DRE | Ação Classificar em AP de compra, inclusive pago; UPDATE restrito a plano de contas, centro de custo, competência e observações; valor, vencimento, fornecedor e baixa preservados |
| Totais | Valores parciais ignorados nos recebidos; consulta truncada nos primeiros 200/500/1000 registros | Totais incluem baixas parciais; carregamento de todas as páginas; falhas de consulta não são apresentadas como resultado financeiro completo |
| Caixa | Inserção e saldo em requests diferentes, erro do saldo ignorado, concorrência perdida; indicador mensal mostrava qualquer data | Registro exclusivamente via RPC com idempotência; mês explícito com período real; saldo atualizado na mesma transação |
| Conciliação | Um botão marcava conciliado sem revisão e a lista podia estar incompleta | Conferência manual explícita de conta/data/valor com o extrato; filtro pendentes/conferidos/todos e reabertura de conferência |
| DRE | Mistura caixa/competência, preferência arbitrária por vendas de jobs, compra de filamento descontada junto com custo de material, `real || estimado` substituía zero real | Resultado gerencial por competência dos títulos, sem duplicar venda do job; aquisições vinculadas ao estoque separadas proporcionalmente; serviços classificados entram nas despesas; compras sem origem ou classificação deixam o resultado explicitamente parcial; perdas apuradas são deduzidas; custo total real prioritário, componentes reais com fallback somente em nulos, extras e ajustes evidenciados |
| Compras | Pedido, itens, parcelas e estoque escritos independentemente; recebimento podia marcar sucesso apesar de erro | Criação de pedido/itens/parcelas por RPC; recebimento idempotente em RPC separado; falha no recebimento após importação informa que a compra já foi criada pendente |
| Quantidades de estoque | Um rolo comprado podia entrar como uma unidade de grama | Conversão explícita `stock_quantity` na unidade do material antes do recebimento; exemplo 1 rolo de 1 kg = 1000 g |
| Parcelamento | Incremento fixo de 30 dias; risco de centavos/parcelas inválidas | Parcelas mensais no mesmo dia (último dia quando necessário), centavos distribuídos sem alterar total |
| NF-e | Chave não validada, duplicação e entradas silenciosas, datas legadas não lidas | Chave de 44 dígitos, RPC com unicidade/idempotência, `dEmi` e `dhEmi`, total documental preservado com outros componentes explícitos |
| Screenshot de compra | Valores extraídos eram importados sem possibilidade de correção | Campos de fornecedor, data, frete, desconto, total, descrição, quantidade e preço editáveis; total precisa conferir antes de importar |
| Sessão | Perfil antigo podia voltar depois de logout/troca de usuário; erro do banco parecia cadastro ausente; rotas privadas renderizavam sem perfil | Geração de requests e sessão atual verificadas; cache limpo/cancelado na troca; falha recuperável com retry; `AuthAccess` impede montar telas privadas antes do perfil |
| Usuários (edge) | Erro ao inserir perfil/role deixava identidade órfã; role inválida virava viewer silenciosamente | Validação explícita de payload/roles; somente POST; rollback de auth user se provisionamento falha, com cascata de perfil/roles |
| Empresa | Logo público apontava para bucket privado; entradas inválidas eram convertidas em custo zero | Logo novo em bucket público de fotos, caminho isolado por tenant e UUID; logo legado usa URL assinada apenas no preview; tipo/tamanho validados; custos finitos não negativos, zero preservado e margem <100% |

## Validação local

- `src/test/finance-integrity.test.ts`: 33 cenários de centavos, entradas inválidas, baixas parciais, atraso, datas, parcelas, DRE e paginação.
- `src/test/financial-classification.test.tsx`: 2 cenários reais de formulário, conferindo whitelist da alteração de título pago e tratamento de conflito de versão.
- `src/test/auth-session-isolation.test.tsx`: 5 cenários de concorrência de sessão, troca de usuário, logout, falha de perfil e onboarding.
- `src/test/company-settings.test.ts`: 8 cenários de parâmetros e logo.
- `npx tsc --noEmit -p tsconfig.app.json`: passou na árvore conjunta após estes ajustes.
- A validação SQL dos RPCs e publicação é responsabilidade do integrador principal. Este trabalho não enviou mensagens ao Lovable nem criou registros de produção para testes.

## Limitações explicitadas na interface / preservadas

- DRE é **gerencial**: competência vem dos títulos; custos são reconhecidos pela conclusão dos jobs. Diferenças entre produção, entrega e reconhecimento de receita exigem fechamento. Não é uma demonstração contábil/fiscal completa.
- Títulos antigos sem competência usam a data de cadastro e recebem aviso. Custos estimados, falhas sem apuração/data e despesas sem classificação aparecem como pendências, com margens indisponíveis. Compras sem vínculo de estoque ou classificação exibem o valor que ainda está fora da apuração parcial.
- Baixas antigas não têm detalhe bancário retroativo; o histórico exibe isso em vez de inventar transações.
- Saldos e estoques antigos não são reescritos automaticamente. O recebimento novo valida conversões e a integridade futura, mas correção do legado exige diagnóstico.
- Conciliação é manual; não é importação automática de OFX ou integração bancária.
- A compensação em `create-user` precisa ser publicada como edge function, além do frontend, para valer no servidor.
