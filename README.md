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
