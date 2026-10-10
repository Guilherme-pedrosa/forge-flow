# Vocabulário da operação 3D

| Termo | Significado no Forge |
| --- | --- |
| Produto / SKU | Unidade comercial vendida. Pode conter várias peças e exigir várias placas. |
| Peça / subitem | Saída física identificada por material e cor, mantida em estoque para posterior montagem. Trocar material ou cor exige identificar outra variante. |
| Placa | Receita de uma execução de impressão: arquivo, perfil, materiais, rendimento e saídas físicas. Não equivale necessariamente a um produto completo. |
| Impressão / job | Uma execução planejada ou realizada da placa. Falha e reposição conservam o vínculo com a demanda original. |
| Ordem de produção / OP | Demanda que reúne as peças, impressões e montagem necessárias. Pode atender uma venda ou repor estoque. |
| Bobina | Carretel físico de um material, com tara, peso e localização próprios. Descreve o estoque existente; seu cadastro não dá entrada no estoque. |
| Reserva de filamento | Gramas destinadas a uma impressão ainda sem consumo lançado. Reduz saldo livre, não baixa estoque e não acrescenta demanda novamente. |
| Consumo real | Material efetivamente apurado e lançado no estoque pela execução. Estimativa do fatiador não confirma consumo real nem a qualidade das peças. |
| Mesa livre | Liberação física confirmada pelo operador. Impressora online ou com estado `idle` não confirma que as peças foram retiradas. |
| Postar até | Instante limite de despacho, com horário e fuso. É diferente da entrega ao comprador. |
| Meta interna | Instante desejado para concluir as impressões, deixando tempo para as operações finais e a postagem. |
| Próxima ação | Passo executável na etapa atual do pedido: preparar, confirmar, produzir, embalar/postar ou confirmar entrega. |
| Inbox de marketplace | Pedidos recebidos do canal, preservados com identidade externa e revisão. Importar não aprova venda, não imprime e não liquida repasse. |
| Margem de contribuição | Receita menos os custos variáveis e despesas de venda informados. Não é lucro líquido nem saldo recebido do canal. |

Várias placas podem ser componentes, lotes ou perfis alternativos. A composição deve ser declarada na preparação; o sistema não deve inferi-la pelo nome do arquivo.
