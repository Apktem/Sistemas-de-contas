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

Sem variáveis de banco, o servidor usa armazenamento temporário apenas em desenvolvimento. Em produção, configure as variáveis documentadas em `.env.example`.

## Hostinger

Crie um banco MySQL e cadastre as variáveis de `.env.example` no painel. Use:

- Build: `pnpm run build`
- Start: `pnpm start`
- Entry file: `server.js`
- Node.js: `22.x`

O e-mail definido em `ADMIN_EMAIL` recebe perfil administrativo ao criar a conta.
