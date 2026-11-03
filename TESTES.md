# Verificações da jornada própria

Executadas em 03/11/2026 em ambiente local, sem pedidos, mensagens ou cobranças externas.

## Servidor e banco

`node --test tests/ordering.test.mjs`: seis testes aprovados.

- Retirada: R$ 0 de entrega; entrega: R$ 8.
- Valores, adicionais, quantidades e sabores calculados pelo servidor.
- Complemento gratuito de açaí não altera o preço base; pizza usa o maior valor dos sabores.
- Cliente não pode alterar o total no navegador; mudanças exigem confirmação.
- Reenvio idempotente não duplica pedido; chave não pode representar outro pedido.
- Pedidos privados exigem a chave correta; painel exige sessão válida; logout invalida a sessão.
- Loja fechada, item esgotado, origem indevida e webhook forjado são recusados.
- Pagamento sem credenciais é bloqueado; adaptador testado com respostas controladas, sem processador real.

## Navegador, cliente e painel

Verificação HTTP com Chromium/Playwright e banco SQLite real:

- Produto com adicional, quantidade, observação e subtotal correto.
- Troca entrega/retirada ajusta total e campos obrigatórios.
- Pedidos de retirada e entrega gravados no banco com taxas corretas.
- Nenhum redirecionamento de checkout ao Anota.ai.
- Painel autenticado vê os pedidos; confirmação atualiza o acompanhamento do cliente.
- Sacola persiste ao recarregar; acompanhamento de pedido anterior não interrompe um novo checkout.
- Larguras de 320, 390, 768 e 1440 pixels, sem rolagem horizontal.
- Zero erros JavaScript e zero assets locais falhos.

## Apresentação pública

A versão apresentada ao comprador usa `mode: 'preview'` e sinaliza que nenhum pedido é enviado. O pagamento online é apenas pré-configurado e fica desativado. A prévia do total não equivale a pedido recebido pela lanchonete.

## Pendente por escolha do comprador

- Conta e implantação do backend persistente.
- Credenciais, homologação e produção de Pix/cartão no processador escolhido.
- Validação do recebimento com a equipe da lanchonete e rotina de cancelamentos/estornos.
- Arquivamento local das fotos ainda hospedadas no domínio S3 da origem, bloqueado pela rede desta máquina.

O GitHub Pages serve a apresentação; não executa a API nem armazena pedidos. A validação local não é uma afirmação de operação real já ativada.
