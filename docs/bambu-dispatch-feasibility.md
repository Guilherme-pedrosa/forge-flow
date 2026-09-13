# Arquivo da ordem e envio Bambu — 13/09/2026

O Forge & Flow prepara a ordem com o arquivo privado, a placa, a impressora e a composição exata de materiais/cores. Não foi executado nenhum comando físico e não há um botão de envio direto sem uma integração funcional por trás.

A Bambu separa monitoramento de operações protegidas como iniciar impressão. O acesso usado para consultar histórico não prova autorização nem capacidade técnica para despachar arquivos. [Comunicado oficial sobre autorização](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/).

O Bambu Connect é o caminho anunciado para transferência por programas terceiros. A Bambu descreve LAN por Connect sem conta/internet e um modo de desenvolvedor habilitado pelo usuário; neste último, MQTT/FTP deixam de ser interfaces oficialmente suportadas. Integrações de fazendas podem depender de parceria e ferramentas fornecidas pela Bambu. [Integração oficial com Bambu Connect](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/).

O comunicado de maio de 2026 reforça as condições do serviço cloud e distingue o acesso permitido da imitação de um cliente oficial. Esta implementação não falsifica Bambu Studio nem transforma credenciais de monitoramento em um cliente de despacho. [Posicionamento oficial sobre acesso cloud](https://blog.bambulab.com/setting-the-record-straight-on-cloud-access-and-community/).

Na infraestrutura examinada há duas A1 vinculadas ao histórico Bambu. A inspeção interna verificou somente presença/ausência de configuração, sem ler códigos secretos: não há endereço LAN cadastrado. O repositório também não contém ponte local ou SDK de despacho configurado. Portanto, envio web direto não está disponível nesta instalação. O esquema de abertura do Connect não foi implementado porque a documentação oficial acessível não confirmou um contrato completo para este caso; não foi adivinhado um link.

O fluxo entregue permite baixar o arquivo por URL privada de 60 segundos, conferir SHA-256 quando registrado e abrir no Bambu Studio/Connect. STL exige fatiamento; 3MF por si só não comprova que está fatiado. Modelo da máquina, bico, placa e mapeamento AMS continuam sujeitos à conferência no software Bambu. A receita aprovada, seu arquivo e seu hash são preservados na OI; um arquivo ausente pode ser associado antes da produção, com justificativa e registro de auditoria.

Para envio direto futuro será necessário provisionar uma ponte/integração suportada, confirmar alcance da máquina e autorização apropriada, validar os perfis do arquivo e exigir uma ação explícita de iniciar impressão. Nenhum desses pré-requisitos é substituído pela sincronização de histórico.
