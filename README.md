# KiGula — site próprio com carrinho e pedidos

A versão de apresentação permite escolher produtos e adicionais, alterar quantidades, montar a sacola e revisar entrega ou retirada no próprio site. O fluxo de compra não encaminha o cliente ao Anota.ai.

**Estado atual: apresentação comercial.** O cliente pediu para deixar pagamentos e operação apenas pré-configurados enquanto consulta o comprador. `config.js` usa `mode: 'preview'`. Nenhum pedido real ou cobrança é enviado nessa modalidade. O botão final mostra uma prévia claramente identificada como não enviada. Não há contas de hospedagem ou de pagamento criadas, nem credenciais reais no projeto.

## Regras definidas

- Entrega em Tamandaré: **R$ 8,00 por pedido**.
- Retirada: **taxa de entrega R$ 0,00**.
- Produtos e adicionais são calculados por unidade e multiplicados pela quantidade.
- Pizza com até dois sabores: considera o maior preço entre os sabores; a borda é uma escolha por pizza.
- Pedido mínimo inicial de produtos: R$ 4,00, conforme a informação pública consultada; pode ser ajustado no painel.
- Horário informado: 18h à meia-noite, sem dias da semana especificados.
- A operação real só recebe pedidos depois que o responsável abrir a loja no painel.

## O que está implementado

### Cliente

- 156 produtos, busca sem acentos, filtros, fotos e personalização dos adicionais.
- Sacola persistida no navegador com itens, quantidades e observações, sem guardar os dados pessoais do formulário.
- Entrega ou retirada, endereço, telefone, pagamento e revisão do total.
- Validação de troco e dados de contato.
- Na apresentação, prévia local sem envio; na operação real, pedido salvo no servidor antes da confirmação.
- Acompanhamento privado com token aleatório, atualização de status e link de acompanhamento.
- Mudanças de preço ou taxa exigem nova confirmação; o servidor recalcula os valores, sem aceitar o total enviado pelo navegador.

### Lanchonete

- Painel próprio em `admin.html`, protegido por autenticação no servidor.
- Lista de pedidos, itens, adicionais, endereço, troco e observações.
- Confirmar, iniciar preparo, informar saída para entrega/pronto para retirada e concluir pedidos.
- Alertas opcionais no navegador, atualização automática e impressão.
- Ajuste de disponibilidade/preço dos produtos simples, taxa de entrega, pedido mínimo e abertura manual da loja.
- Pedidos só são visíveis no painel com sessão autorizada. O arquivo público do painel não contém senha.

### Pagamentos preparados, não ativados

- Dinheiro e cartão na entrega/retirada.
- Adaptador de Pix e cartão online com Mercado Pago, para futura validação e escolha do estabelecimento.
- QR Code Pix e formulário de cartão incorporados ao site, sem redirecionamento de compra.
- Verificação de valor/moeda/referência no servidor, idempotência e webhook com assinatura.
- Sem credenciais válidas, os pagamentos online ficam indisponíveis. Os testes do adaptador usam um processador de teste controlado, sem cobranças reais. A integração real ainda precisa ser homologada com as contas de teste e de produção do estabelecimento.
- Pedidos pagos não são cancelados pelo painel sem o processo de estorno. A ativação deve incluir a definição operacional de cancelamentos e estornos com o comprador.

## Apresentação estática

Na raiz do projeto:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

O fluxo atual usa módulos JavaScript: sirva por HTTP/HTTPS. GitHub Pages pode hospedar esta **apresentação**, mas não executa o servidor de pedidos.

Para preparar a pasta pública:

```sh
python3 scripts/prepare_ordering.py --mode preview
```

A pasta `public/` contém apenas os arquivos do navegador. Não contém banco de dados, senha, código de administração do servidor ou credenciais. O painel visual é público, mas os dados e as alterações administrativas dependem da API protegida.

## Servidor local e testes de operação

Requer Node.js 24 ou superior (módulo `node:sqlite`), sem dependências de runtime:

```sh
python3 scripts/prepare_ordering.py --mode live
node ordering/local.mjs
```

Configure `ADMIN_PASSWORD` apenas no ambiente privado local, com pelo menos 12 caracteres, antes de testar o painel. O banco local fica em `.local/orders.sqlite`, ignorado pelo Git. Ele preserva os pedidos entre reinicializações. O servidor se limita a `127.0.0.1` para desenvolvimento. Não use esta rotina local como hospedagem pública improvisada.

```sh
node --test tests/ordering.test.mjs
```

Os testes verificam os valores de entrega e retirada, adicionais/sabores, privacidade, autorização, idempotência, alterações de preço e pagamento com fornecedor controlado. Nenhum pedido ou pagamento é enviado a um estabelecimento/processador real.

## Hospedagem preparada

A opção preparada é **Cloudflare Workers + D1**, com o mesmo site e API e banco persistente. O plano gratuito tem limites de uso definidos pelo provedor; não foi contratado plano pago.

- `wrangler.jsonc`: configuração de implantação, com ID do banco ainda por preencher.
- `ordering/schema.sql`: tabelas de configuração, pedidos, sessões e pagamentos.
- `ordering/catalog.sql`: carga do catálogo, gerada por `python3 ordering/seed.py`.
- `ordering/worker.mjs`: API de pedidos, painel e notificações de pagamento.
- `ordering/pricing.mjs`: cálculo compartilhado entre navegador e servidor.
- `ordering/payments.mjs`: adaptador do processador de pagamento.

Veja `ATIVACAO-FUTURA.md`. **Não trocar para operação real nem publicar um servidor recebendo dados enquanto o comprador não aprovar e configurar a operação.** A pré-configuração não equivale a uma integração de pagamento homologada.

## Catálogo e recursos

O catálogo inicial foi obtido do endereço público fornecido pelo usuário em 03/11/2026. É uma cópia, sem sincronização automática com o Anota.ai. O objetivo da operação é administrar a disponibilidade e os preços no próprio sistema.

A logo original está incorporada como recurso local. Há 59 fotos distintas locais (42 produtos principais e 17 sabores), 106 produtos usam os endereços de imagem da origem e oito não têm foto na fonte. Essas imagens remotas dependem de internet. As fontes, licenças e URLs estão em `assets/SOURCES.md` e `data/menu.json`.

O antigo ZIP e o HTML único em `entregas/` eram da primeira versão e não representam esta nova jornada de pedidos. Para apresentar a versão atual, use o site publicado ou a pasta `public/` gerada em modo de apresentação.
