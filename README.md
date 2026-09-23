# Sorteio Natu Vale

Página única de sorteio: cada pessoa informa o @ do Instagram, todos veem a
lista de participantes e o resultado dos sorteios ao vivo. O administrador
libera o sorteio pelo **botão do cadeado** (canto superior da caixa), com a
senha combinada.

Feito em HTML/CSS/JS puro — pode ser hospedado de graça no **GitHub Pages**.

## Dois modos de funcionamento

| | Modo demonstração | Modo real |
|---|---|---|
| Quando | `js/config.js` sem os dados do Supabase (padrão) | `js/config.js` preenchido com o Supabase |
| Onde os dados ficam | Só no navegador de quem abriu | No banco Supabase (gratuito) |
| Lista compartilhada entre celulares | ❌ (cada aparelho vê só o que foi feito nele) | ✅ em tempo real |
| Serve para | Ver o visual e testar tudo | O sorteio de verdade |

O site mostra um aviso amarelo enquanto estiver em modo demonstração.

## Estrutura das pastas

```
index.html            A página (participação, lista, resultado, cadeado)
assets/logo.png       ← LOGO (troque este arquivo, mesmo nome)
assets/favicon.png    Ícone da aba
css/styles.css        Visual (cores da marca no topo do arquivo)
js/config.js          ← dados do Supabase (deixe como está = demonstração)
js/app.js             Lógica da página e do modo administrador
js/common.js          Lista ao vivo, histórico, animação do sorteio
js/demo.js            Banco "de mentira" do modo demonstração
supabase/schema.sql   Cria o banco real (rodar 1x no Supabase)
supabase/trocar-senha.sql   Troca a senha do administrador
supabase/zerar-sorteio.sql  Apaga participantes e histórico
```

## O botão do cadeado (administrador)

1. Clique no **cadeado** no canto superior da caixa.
2. Digite a senha e clique em **ENTRAR**.
3. Aparecem: selo **MODO ADMINISTRADOR**, botão **SORTEAR**, histórico completo
   com data/hora e total de participantes, botão **Limpar** e um **×** ao lado
   de cada participante para excluir.
   O campo do @ vira **ADICIONAR** e não trava: o administrador pode colocar
   quantos @ quiser, um de cada vez ou vários juntos (separados por espaço,
   vírgula ou um por linha — dá para colar uma lista). O @ continua único:
   repetidos e inválidos são avisados e não entram.
4. O modo administrador vale só naquela aba. Para sair: cadeado → **SAIR**
   (ou feche a aba).

Segurança: a senha **não está escrita em nenhum arquivo** do site. No modo
real ela é conferida pelo banco, que guarda só um hash (bcrypt). Mesmo que
alguém mostre o botão SORTEAR mexendo no HTML, o banco recusa sem a senha.

## Publicar no GitHub Pages (grátis, sem instalar nada)

1. Entre em <https://github.com> (crie a conta, se ainda não tiver).
2. Clique em **+** (canto superior direito) → **New repository**.
   - *Repository name*: `sorteio-nvc`
   - Marque **Public**
   - Clique em **Create repository**.
3. Na página do repositório vazio, clique no link **uploading an existing file**.
4. Abra a pasta do site no computador, selecione **tudo o que está dentro dela**
   (`index.html`, `README.md` e as pastas `assets`, `css`, `js`, `supabase`) e
   arraste para a página do GitHub.
   Importante: o `index.html` precisa ficar na raiz do repositório, e não
   dentro de outra pasta.
5. Clique em **Commit changes**.
6. Vá em **Settings → Pages**. Em *Build and deployment*:
   *Source* = **Deploy from a branch**, *Branch* = **main** e **/(root)** →
   **Save**.
7. Aguarde 1 a 2 minutos e recarregue a página de Settings → Pages. O endereço
   aparece no topo, no formato:
   `https://SEU-USUARIO.github.io/sorteio-nvc/`

**Para atualizar depois:** no repositório, **Add file → Upload files**, arraste
os arquivos alterados (mesmos nomes e pastas) e clique em **Commit changes**.
O site atualiza em 1 a 2 minutos (use **Ctrl + F5** para ver a versão nova).

> O repositório público deixa os arquivos visíveis para qualquer pessoa. Não
> há nada sensível neles: a senha não está nos arquivos (só hashes), e a chave
> do Supabase que vai no `config.js` é pública por natureza.

## Ativar o modo real (Supabase) — necessário para o sorteio valer para todos

1. Crie uma conta em <https://supabase.com> → **New project** (região
   *South America (São Paulo)*).
2. **SQL Editor → New query** → cole todo o `supabase/schema.sql` → **Run**.
   Isso cria as tabelas, as regras de segurança, o tempo real e a senha do
   administrador.
3. Copie dois dados do projeto:
   - **Project Settings → Data API → Project URL**
   - **Project Settings → API Keys → Publishable key** (`sb_publishable_…`)
4. Cole em `js/config.js`:
   ```js
   window.SORTEIO_CONFIG = {
     supabaseUrl: "https://abcdefghijk.supabase.co",
     supabaseKey: "sb_publishable_xxxxxxxxxxxxxxxx",
   };
   ```
5. Envie o `config.js` atualizado para o GitHub (veja "Para atualizar depois").
   O aviso amarelo some e a lista passa a ser compartilhada em tempo real.

**Nunca** coloque no site a *secret key* / *service_role* do Supabase.

### Trocar a senha do administrador

Modo real: edite `supabase/trocar-senha.sql` colocando a nova senha, rode no
**SQL Editor** e **não** salve o arquivo com a senha real (ele iria para o GitHub).

## Testar no computador

Basta dar dois cliques no `index.html` (abre em modo demonstração).
Para simular dois aparelhos, abra também numa **janela anônima**.

## Usar um domínio da Natu Vale (opcional)

Exemplo: `sorteio.natuvale.com.br`

1. No GitHub: **Settings → Pages → Custom domain** → digite
   `sorteio.natuvale.com.br` → **Save**.
2. No painel de DNS do domínio `natuvale.com.br`, crie:

   | Tipo | Nome | Valor |
   |---|---|---|
   | CNAME | `sorteio` | `SEU-USUARIO.github.io` |

3. Quando o GitHub confirmar, marque **Enforce HTTPS**.

## Operação no dia do sorteio

- **Projeto pausado:** no plano gratuito do Supabase, projetos sem uso por 7
  dias são pausados. Entre no painel alguns dias antes e, se preciso, clique em
  **Restore project**.
- **Muitos acessos ao mesmo tempo:** o plano gratuito aceita cerca de 200
  conexões de tempo real simultâneas. Acima disso, quem ficar de fora vê
  **"reconectando…"** e a página se atualiza sozinha a cada 15 segundos.
- **Novo sorteio do zero:** rode `supabase/zerar-sorteio.sql` no SQL Editor.
- **Um mesmo @ pode ser sorteado de novo:** ninguém sai da lista ao ser sorteado.

## Limites conhecidos

- O **@ único** é garantido pelo banco, sem exceções.
- **Um cadastro por aparelho** usa um identificador salvo no navegador
  (localStorage + cookie). Dificulta, mas quem usar janela anônima ou outro
  navegador consegue cadastrar **outro** @.
- O site valida o formato do @ (letras, números, ponto e sublinhado, até 30
  caracteres), mas não confere se o perfil existe no Instagram.
