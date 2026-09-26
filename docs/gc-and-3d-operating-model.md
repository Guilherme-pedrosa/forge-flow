# GestãoClick como referência, produção 3D como especialização

Revisão em 26/09/2026. Diretriz do usuário: reproduzir telas e funcionamento do GC nos cadastros, orçamentos, vendas, compras, estoque e financeiro; adaptar ordens de serviço para produção 3D. Nenhuma mensagem ao agente do Lovable.

## Evidência observada

Sessão autenticada do GC: produto com Dados/Valores/Estoque/Fotos/Composição; custo de compra + despesas = custo final; preço editável; saldo inicial/mínimo/máximo. Compra com fornecedor, linhas de produtos, custo, frete, total e parcelas editáveis. Entrada/saída de estoque com várias linhas. Financeiro com período, vencimento, competência, classificação, contato e pagamento. Orçamento com dados comerciais, produtos/serviços, frete, desconto, pagamento, observações públicas e internas. Fornecedor com tipo de pessoa, situação, nome, documentos, contatos e endereços. Inspeção sem cadastrar, excluir, enviar ou converter registros reais.

## Referências oficiais de produção

- [DigiFabster: Orders and workflows](https://help.digifabster.com/en/articles/6820487-orders-and-workflows): oferta, aceitação, revisão técnica, fabricação, pós-processo, reimpressão e entrega são etapas distintas.
- [Printago: overview](https://docs.printago.io/docs/overview/what-is-printago): relaciona itens comerciais a modelos por SKU; encaminha trabalhos conforme material, cor, bico e tamanho da mesa.
- [Printago: API](https://developers.printago.io/): integração de fila, trabalhos e impressoras, além de dados de execução.
- [Authentise MES](https://docs.authentise.com/mes/overview.html): relaciona pedidos, materiais e máquinas; andamento pode vir da operação ou telemetria.
- [SimplyPrint API](https://help.simplyprint.io/en/article/the-simplyprint-api-a-quick-intro-for-developers-17fpo7l/): distingue leitura/consulta de comandos para iniciar impressão; webhooks informam eventos. Capacidade depende da autorização e do plano contratado.

Não são substitutos diretos do ERP brasileiro nem uma decisão de contratar esses serviços. A aplicação abaixo é uma síntese para o Forge.

## Fluxo adotado

1. Cadastrar produto, cliente e fornecedor independentemente de arquivos ou impressoras. Custo, preço e estoque ficam acessíveis no produto.
2. Elaborar orçamento com cliente, itens, quantidades, preços, desconto, frete, condições e prazo. Produção incompleta informa pendência interna, sem bloquear a proposta.
3. Gerar venda com recebível, ou solicitar ordem de produção sem lançar receita automaticamente. Se houver ambos, compartilhar a mesma demanda, sem duplicar produção.
4. Preparar a OP: arquivos/placas, material/cor, quantidade por impressão, tempo e impressoras. Preservar separadamente a proposta comercial e a versão técnica liberada.
5. Liberar trabalhos para a fila existente. A integração acompanha execução, falhas, material, tempo e reimpressões. Finalização física inclui pós-processo e qualidade.
6. Compras geram obrigações financeiras; recebimento movimenta estoque; recebimentos/pagamentos liquidam títulos. Tentativas repetidas não duplicam títulos, saldos ou trabalhos.

## Diagnóstico do código atual

- Emissão de orçamento e aprovação de venda exigiam composição/tempo de impressão: exigência na etapa errada.
- Existia tabela de fornecedores, mas não uma tela própria de cadastro.
- Orçamento só convertia em venda. Não existia documento de OP separado da impressão individual.
- Integração Bambu atual consulta dispositivos, telemetria, projetos e histórico; não contém comando de início/pausa da máquina. Status interno não equivale a comando físico. Não anunciar controle remoto antes de implementar e testar o adaptador com as capacidades reais da conexão.

## Verificação da entrega

Fluxos a verificar com dados isolados: produto só comercial com custo/saldo; cliente e fornecedor completos; orçamento emitido sem receita; orçamento para venda com recebível único; orçamento para OP sem recebível; preparação posterior e liberação sem duplicar trabalhos; compra e parcelas; entrada/saída; exclusão de cadastros sem uso e cancelamento de documentos com histórico. Comparação visual em navegador faz parte da validação, além dos testes de banco.
