# Gestão Financeira

Aplicativo multiusuário para controle financeiro pessoal e empresarial.

## Recursos

- Cadastro e login com e-mail ou CPF
- Senhas protegidas com bcrypt e sessão em cookie HTTP-only
- CPF armazenado como hash, com exibição mascarada
- Contas, cartões e lembretes isolados por usuário
- Painel administrativo com usuários, totais e ativação de contas
- Plano Grátis com limites e plano Pro recorrente de R$ 29,90 pelo Mercado Pago
- Consulta e cancelamento de assinatura pelo próprio usuário
- Tags, clonagem mensal e parcelamentos com previsão para os próximos seis meses
- Notificações push de vencimento no celular e no computador
- Interface responsiva e instalável no celular

## Desenvolvimento

```bash
pnpm install
pnpm test
pnpm build
pnpm start
```

Sem variáveis de banco, o servidor usa armazenamento temporário apenas em desenvolvimento. Em produção, configure `SUPABASE_URL` e `SUPABASE_API_KEY` conforme `.env.example` e execute `supabase-schema.sql` no SQL Editor do Supabase. As chaves internas de sessão e CPF são derivadas da chave secreta do servidor.

## Hostinger

Conecte um projeto Supabase pelo assistente da Hostinger e cadastre as demais variáveis de `.env.example`. Use:

- Build: `pnpm run build`
- Start: `pnpm start`
- Entry file: `bootstrap.cjs`
- Node.js: `22.x`

O e-mail definido em `ADMIN_EMAIL` recebe perfil administrativo ao criar a conta.

## Mercado Pago

1. Execute novamente `supabase-schema.sql` no SQL Editor para criar a tabela `subscriptions`.
2. Crie uma aplicação em **Mercado Pago > Suas integrações** e copie o Access Token de produção.
3. Na Hostinger, adicione `MERCADOPAGO_ACCESS_TOKEN`, `SITE_URL=https://ricoxp.com` e `PRO_PRICE=29.90`.
4. Salve e reimplante o aplicativo.

O checkout cria uma assinatura mensal pela API de Preapproval. O retorno e o webhook consultam a assinatura diretamente no Mercado Pago antes de atualizar o plano do usuário. Nunca coloque o Access Token no frontend ou no GitHub.

## Perfis e recuperação de senha

Execute novamente `supabase-schema.sql` no SQL Editor sempre que atualizar esta versão. O script adiciona nome, foto de perfil e a tabela de tokens temporários sem apagar os dados existentes.

Para enviar os links de recuperação pela caixa `contato@ricoxp.com`, configure na hospedagem:

```env
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=contato@ricoxp.com
SMTP_PASS=senha_da_caixa_de_email
SMTP_FROM=RicoXP <contato@ricoxp.com>
```

O link de redefinição expira em 30 minutos e só pode ser usado uma vez. A senha da caixa de e-mail deve existir apenas nas variáveis protegidas da Hostinger.

## Notificações push

Gere as chaves VAPID com `pnpm exec web-push generate-vapid-keys` e configure na Hostinger `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`. A chave privada deve permanecer somente nas variáveis de ambiente do servidor.

No Android e no computador, o usuário pode ativar as notificações pelo navegador. No iPhone, o sistema precisa ser adicionado à Tela de Início antes da permissão ser solicitada. O servidor verifica contas pendentes a cada seis horas e registra cada envio para não repetir o mesmo alerta no mesmo dia.
