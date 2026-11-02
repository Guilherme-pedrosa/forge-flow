# Compras, insumos e financeiro

Importar XML abre uma conferência única: fornecedor, itens, condições financeiras e recebimento. O XML é lido localmente; não usa OCR, IA ou o agente Lovable.

- O seletor carrega todos os insumos ativos e todos os vínculos de estoque dos produtos, incluindo produtos arquivados. Estoque de produto acabado fica fora das compras; uma proteção no servidor também impede novos vínculos indevidos. Vínculos históricos e recebimentos já existentes não são reescritos.
- A descrição fiscal e os decimais da nota ficam preservados. O nome interno pode ser definido num novo cadastro ou alterado explicitamente no insumo selecionado. Renomear o insumo não altera o texto fiscal, saldo ou custo médio.
- Uma sugestão mostra o motivo e pede confirmação. É possível selecionar outro insumo, cadastrar filamento por material/cor, cadastrar outro insumo ou marcar explicitamente uma despesa/serviço sem estoque. A sugestão nunca seleciona o item ou presume massa.
- Quantidade comercial e quantidade de entrada são distintas. `2 UN` não vira automaticamente `2000 g`; informe o peso líquido ou a conversão confirmada. O novo insumo da compra inicia sem saldo e sem custo: o recebimento atualiza ambos pelo fluxo existente.
- Fornecedor pode ser criado com os dados conhecidos da nota, na mesma operação. Clientes também podem ser cadastrados no pedido, preservando o rascunho e selecionando o novo cadastro.
- Os pagamentos declarados e as duplicatas reais aparecem na conferência. Vencimentos irregulares são mantidos; se não houver duplicatas, nenhuma data é presumida. Selecione a forma cadastrada, o plano de contas e, se aplicável, o centro de custo. Formas diferentes podem ser escolhidas por parcela. Cadastros financeiros ausentes podem ser criados nessa tela.
- A importação não registra pagamento nem baixa bancária a partir do XML. Desativar o lançamento das parcelas é uma escolha explícita e também não significa que a compra foi paga.
- **Importar e Receber** usa uma única chamada `save_quick_purchase`: compra, parcelas e recebimento são uma transação. Uma falha reverte a operação. Repetir após perda de resposta mantém a identidade do pedido; não duplica a entrada.

Valores fiscais inconsistentes são mostrados para revisão; o importador não modifica o total ou o preço da nota para forçar a gravação. A soma das parcelas deve conferir com o total da compra.

Os nomes apresentados para `tPag` são rótulos de exibição. Não determinam IDs do cadastro nem confirmam liquidação. Referências: [tabela nacional de meios de pagamento](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D) e [distinção entre Pix dinâmico e estático](https://atendimento.receita.rs.gov.br/15-como-deve-ser-feita-a-integracao-quando-o-pagamento-for-feito-com-pix).

Validação: parser e matching, catálogos completos, formulário, parcelamento, recebimento atômico, retries e isolamento de sessão; scripts `test-purchase-import-review.mjs` e `test-purchase-material-links.mjs` em PostgreSQL descartável. Os XMLs dos testes são sintéticos.
