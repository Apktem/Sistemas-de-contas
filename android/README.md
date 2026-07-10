# RicoXP na Google Play

Este diretorio guarda a preparacao do app Android do RicoXP usando TWA (Trusted Web Activity). O app abre o mesmo sistema de `https://ricoxp.com`, portanto os usuarios atuais continuam usando a mesma base, login, pagamentos e dados.

## O que ja ficou preparado

- Manifest PWA em `manifest.webmanifest` com abertura em `/login`.
- Icones oficiais em `assets/ricoxp-icon-192.png` e `assets/ricoxp-icon-512.png`.
- Rota `/.well-known/assetlinks.json` no servidor para validar o vinculo entre o dominio e o app Android.
- Modelo de configuracao do Bubblewrap em `android/twa-manifest.template.json`.

## Passo a passo para gerar o app

1. Instale Java JDK 17 ou superior e Android Studio.
2. Instale o Bubblewrap CLI:

```bash
npm install -g @bubblewrap/cli
```

3. Em uma pasta fora do projeto principal, inicialize o app usando o manifest publicado:

```bash
bubblewrap init --manifest https://ricoxp.com/app-manifest
```

4. Use estes dados quando solicitado:

- Package ID: `com.ricoxp.app`
- App name: `RicoXP Gestao Financeira`
- Launcher name: `RicoXP`
- Start URL: `/login?source=twa`
- Icon URL: `https://ricoxp.com/brand-icon-512`

5. Gere a chave de assinatura ou use a chave criada pelo Bubblewrap. Guarde o arquivo `.keystore` e a senha em local seguro.

6. Gere o pacote de teste:

```bash
bubblewrap build
```

7. Pegue a impressao digital SHA-256 da chave usada para assinar o app:

```bash
keytool -list -v -keystore android.keystore -alias ricoxp
```

8. Na Hostinger, configure:

```env
ANDROID_PACKAGE_NAME=com.ricoxp.app
ANDROID_SHA256_CERT_FINGERPRINTS=SUA:IMPRESSAO:DIGITAL:SHA256
```

Se a Play App Signing gerar outra impressao digital, coloque as duas separadas por virgula.

9. Reimplante o site e confirme se esta URL abre um JSON valido:

```text
https://ricoxp.com/.well-known/assetlinks.json
```

10. Gere o arquivo final `.aab` e envie para teste interno no Google Play Console.

## Importante

- Nao publique o app em producao antes de testar login, cadastro, assinatura, Pix/cartao, notificacoes, lista de compras e paineis.
- O arquivo `.keystore` nunca deve ir para o GitHub.
- A Politica de Privacidade e os Termos de Uso precisam estar publicados e informados no Google Play Console.