# Ativação futura — somente após decisão do comprador

A versão atual é uma apresentação: não envia pedidos, não cobra pagamentos e não simula recebimento pela lanchonete. O comprador ainda definirá a operação. Nenhuma conta foi criada nesta preparação.

## Decisões do estabelecimento

- Confirmar itens disponíveis, preços e ingredientes, incluindo restrições alimentares.
- Confirmar dias e horários, pedido mínimo e cobertura de entrega.
- Manter a entrega em R$ 8,00 ou ajustar a regra no painel; retirada é sem taxa de entrega.
- Definir quem acompanha o painel e confirma os pedidos.
- Escolher o processador de pagamento e aprovar suas taxas, prazos de recebimento e regras de estorno.
- Definir os dados do estabelecimento e a rotina de retenção/eliminação de pedidos com dados de clientes.

## Cloudflare Workers + D1

1. Usar uma conta Cloudflare do estabelecimento, com os limites do plano adequados à operação.
2. Criar o banco D1 `kigula-pedidos` e preencher seu `database_id` em `wrangler.jsonc`.
3. Aplicar `ordering/schema.sql` e depois `ordering/catalog.sql` ao banco remoto. A carga do catálogo só deve ser executada na ativação ou atualização intencional, pois substitui preços e disponibilidade.
4. Configurar `ADMIN_PASSWORD` como segredo do Worker, com senha forte de pelo menos 12 caracteres. Não enviar a senha por conversa e não incluí-la no GitHub.
5. Preparar os arquivos com `python3 scripts/prepare_ordering.py --mode live` e implantar o Worker com a CLI oficial Wrangler. A pasta de assets é `public/`.
6. Validar a API, banco persistente, HTTPS, autenticação, permissões e recuperação dos pedidos antes de abrir o recebimento.
7. Entrar em `/admin.html`, revisar os dados e ativar “Receber pedidos agora”. O banco começa com a loja fechada.

Se o frontend permanecer no GitHub Pages, `apiBase` em `config.js` deve apontar para a API própria, e `ALLOWED_ORIGINS` no servidor deve conter a origem exata do site. Hospedar tudo no Worker evita essa configuração adicional e mantém uma única origem.

## Pagamento online

A integração proposta é Mercado Pago. Deve ser homologada com a conta do estabelecimento; outro processador exigirá adaptar `ordering/payments.mjs` e o componente de cartão.

Segredos do servidor, não arquivos públicos:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `MERCADOPAGO_PUBLIC_KEY` (é uma chave pública, mas é configurada junto ao ambiente e entregue ao componente seguro quando necessário)

No painel do processador, configurar notificações para `https://DOMINIO-DA-LOJA/api/payments/webhook`. Usar a assinatura correspondente ao segredo configurado. Os dados de cartão são tratados pelo componente do processador; o backend só recebe o token de pagamento.

Antes da produção, executar testes oficiais de Pix/cartão, rejeição, expiração, idempotência, valor divergente, atualização de status e estorno. O código preparado não recebeu credenciais reais e não foi homologado com o processador.

Não indicar pagamento como aprovado por retorno do navegador: a autorização vem da API do processador, com conferência do valor, moeda e pedido. Na ausência das credenciais, a interface mantém as opções online desativadas.
