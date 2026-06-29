# Gestão Financeira

Aplicativo multiusuário para controle financeiro pessoal e empresarial.

## Recursos

- Cadastro e login com e-mail ou CPF
- Senhas protegidas com bcrypt e sessão em cookie HTTP-only
- CPF armazenado como hash, com exibição mascarada
- Contas, cartões e lembretes isolados por usuário
- Painel administrativo com usuários, totais e ativação de contas
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
