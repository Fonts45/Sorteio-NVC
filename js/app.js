// =====================================================================
//  Sorteio Natu Vale — página única
//   • Todos: participam com o @ e acompanham lista e sorteios ao vivo.
//   • Administrador: botão do cadeado → senha → libera SORTEAR,
//     histórico completo e exclusão de participantes.
//
//  A senha NÃO fica neste código: ela é enviada ao banco, que confere
//  (supabase/schema.sql). Mesmo mexendo no HTML, ninguém sorteia sem ela.
// =====================================================================
(function () {
  "use strict";

  const S = window.Sorteio;
  if (!S.pronto()) return;

  const CHAVE_PARTICIPACAO = "natuvale_sorteio_participacao";
  const CHAVE_ADMIN = "natuvale_sorteio_admin"; // sessionStorage: vale só nesta aba

  const $ = (id) => document.getElementById(id);
  const form = $("form-participar");
  const campo = $("campo-instagram");
  const caixaCampo = $("caixa-campo");
  const botao = $("botao-participar");
  const mensagem = $("mensagem");
  const avisoJaParticipa = $("ja-participa");
  const subtitulo = $("subtitulo");

  const dispositivo = S.obterDispositivo();
  let enviando = false;
  let bloqueadoCom = null; // @ exibido no formulário bloqueado
  let versao = 0; // muda a cada participação confirmada: descarta respostas antigas do servidor
  let senhaAdmin = null; // preenchida só depois que o banco confirma a senha

  // ---------- Lista, histórico e resultado em tempo real ----------

  const lista = S.ListaParticipantes({
    elLista: $("lista-participantes"),
    elContador: $("contador"),
    elBusca: $("busca"),
    elVazio: $("lista-vazia"),
    // O admin excluiu este @ (ou zerou o sorteio): confere e libera o formulário.
    onRemovido: (p) => {
      if (p.instagram_username_normalizado === bloqueadoCom) conferirNoServidor();
    },
  });

  const historico = S.Historico({
    elLista: $("lista-historico"),
    elSecao: $("secao-historico"),
    elVazio: $("historico-vazio"),
  });

  const resultado = S.Resultado({
    el: $("resultado"),
    elAnuncio: $("anuncio"),
    rolarAteResultado: true,
  });

  const sincronizacao = S.iniciarSincronizacao({
    lista,
    historico,
    resultado,
    elStatus: $("status-ao-vivo"),
    carregarSorteios: async () => {
      if (!senhaAdmin) return S.carregarUltimosSorteios();
      const { data, error } = await S.db.rpc("historico_completo", { p_senha: senhaAdmin });
      if (!error) return data;
      if (S.codigoErro(error) === "SENHA_INVALIDA") sairDoAdmin(); // senha trocada no banco
      return S.carregarUltimosSorteios();
    },
  });

  // =================================================================
  //  PARTICIPAÇÃO
  // =================================================================

  function mostrarMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = "mensagem " + tipo;
    mensagem.hidden = false;
    caixaCampo.classList.toggle("com-erro", tipo === "erro");
  }

  function esconderMensagem() {
    mensagem.hidden = true;
    caixaCampo.classList.remove("com-erro");
  }

  function textoBotao(elBotao, texto, carregando) {
    elBotao.replaceChildren();
    if (carregando) {
      const s = document.createElement("span");
      s.className = "spinner";
      s.setAttribute("aria-hidden", "true");
      elBotao.appendChild(s);
    }
    elBotao.append(texto);
  }

  // Desenha o formulário conforme o estado:
  //  • admin: campo sempre livre para adicionar quantos @ quiser;
  //  • visitante que já participa: campo travado com o @ dele;
  //  • visitante novo: campo livre para participar.
  function renderizarFormulario() {
    const travado = !senhaAdmin && !!bloqueadoCom;
    campo.disabled = travado;
    caixaCampo.classList.toggle("bloqueado", travado);
    botao.disabled = travado;
    avisoJaParticipa.hidden = !travado;
    if (senhaAdmin) {
      subtitulo.textContent = "Adicione quantos @ quiser — vários de uma vez, separados por espaço, vírgula ou linha.";
      campo.placeholder = "usuario1 usuario2 …";
      campo.maxLength = 20000;
      textoBotao(botao, "ADICIONAR");
    } else {
      subtitulo.textContent = "Informe o seu @ do Instagram.";
      campo.placeholder = "seu.usuario";
      campo.maxLength = 80;
      if (travado) campo.value = bloqueadoCom;
      textoBotao(botao, travado ? "PARTICIPANDO ✓" : "PARTICIPAR");
    }
  }

  function bloquear(usuario) {
    bloqueadoCom = usuario;
    S.salvarLocal(CHAVE_PARTICIPACAO, usuario);
    caixaCampo.classList.remove("com-erro");
    lista.marcarMeu(usuario);
    renderizarFormulario();
  }

  function liberar() {
    bloqueadoCom = null;
    S.apagarLocal(CHAVE_PARTICIPACAO);
    if (!senhaAdmin) {
      campo.value = "";
      esconderMensagem();
    }
    lista.marcarMeu(null);
    renderizarFormulario();
  }

  // Mostra na hora o que este navegador lembra e confirma com o servidor
  // (o servidor é quem manda: se o admin excluir a participação ou zerar
  // o sorteio, o navegador volta a poder participar).
  const lembrado = S.lerLocal(CHAVE_PARTICIPACAO);
  if (lembrado) bloquear(lembrado);

  function conferirNoServidor() {
    const pedido = versao;
    return S.db.rpc("status_dispositivo", { p_dispositivo: dispositivo }).then(({ data, error }) => {
      if (error || pedido !== versao) return null;
      if (data) bloquear(data);
      else if (bloqueadoCom) liberar();
      return data;
    });
  }
  conferirNoServidor();

  // O "@" já aparece fixo no campo: se a pessoa digitar @ ou espaços, removemos.
  // (No modo admin, não: lá os espaços separam vários @.)
  campo.addEventListener("input", () => {
    if (!mensagem.hidden) esconderMensagem();
    if (senhaAdmin) return;
    const antes = campo.value;
    const depois = antes.replace(/^@+/, "").replace(/\s+/g, "");
    if (depois !== antes) {
      const pos = Math.max(0, (campo.selectionStart || 0) - (antes.length - depois.length));
      campo.value = depois;
      campo.setSelectionRange(pos, pos);
    }
  });

  campo.addEventListener("blur", () => {
    if (!campo.disabled && !senhaAdmin) campo.value = S.limparInstagram(campo.value);
  });

  // Admin colando uma lista com um @ por linha: o campo tem uma linha só,
  // então trocamos as quebras de linha por espaços antes de colar.
  campo.addEventListener("paste", (evento) => {
    if (!senhaAdmin || !evento.clipboardData) return;
    const texto = evento.clipboardData.getData("text");
    if (!/[\r\n]/.test(texto)) return;
    evento.preventDefault();
    campo.setRangeText(texto.replace(/[\r\n]+/g, " ").trim() + " ", campo.selectionStart, campo.selectionEnd, "end");
  });

  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    if (enviando || campo.disabled) return;
    if (senhaAdmin) adicionarComoAdmin();
    else participar();
  });

  // Mostra no máximo 8 itens e resume o resto ("e mais 5").
  function resumirLista(itens) {
    const primeiros = itens.slice(0, 8).join(", ");
    return itens.length > 8 ? primeiros + " e mais " + (itens.length - 8) : primeiros;
  }

  async function adicionarComoAdmin() {
    const entradas = campo.value.split(/[\s,;]+/).map(S.limparInstagram).filter(Boolean);
    if (!entradas.length) {
      mostrarMensagem("Digite um ou mais @ para adicionar.", "erro");
      campo.focus();
      return;
    }
    if (entradas.length > 500) {
      mostrarMensagem(S.traduzirErro({ message: "LISTA_GRANDE_DEMAIS" }), "erro");
      return;
    }

    enviando = true;
    botao.disabled = true;
    textoBotao(botao, "ADICIONANDO", true);
    esconderMensagem();

    let resposta;
    try {
      resposta = await S.db.rpc("adicionar_participantes_admin", { p_senha: senhaAdmin, p_usernames: entradas });
    } catch (erro) {
      resposta = { error: erro };
    }
    enviando = false;
    renderizarFormulario();

    if (resposta.error) {
      if (!falhaAdmin(resposta.error)) mostrarMensagem(S.traduzirErro(resposta.error), "erro");
      return;
    }

    const linhas = resposta.data || [];
    const com = (situacao) => linhas.filter((l) => l.situacao === situacao);
    const adicionados = com("ADICIONADO");
    const jaEstavam = com("USUARIO_JA_CADASTRADO");
    const invalidos = com("USUARIO_INVALIDO");

    adicionados.forEach((l) =>
      lista.adicionar({ id: l.participante_id, instagram_username_normalizado: l.usuario, criado_em: l.cadastrado_em })
    );

    const partes = [];
    if (adicionados.length === 1) partes.push("@" + adicionados[0].usuario + " adicionado.");
    else if (adicionados.length > 1) partes.push(adicionados.length + " @ adicionados.");
    if (jaEstavam.length) partes.push("Já estavam na lista: " + resumirLista(jaEstavam.map((l) => "@" + l.usuario)) + ".");
    if (invalidos.length) partes.push("Inválidos (ficaram no campo para corrigir): " + resumirLista(invalidos.map((l) => l.entrada)) + ".");
    if (!partes.length) partes.push("Nenhum @ novo para adicionar.");

    // Os inválidos continuam no campo para a pessoa corrigir; o resto sai.
    campo.value = invalidos.map((l) => l.entrada).join(" ");
    mostrarMensagem(partes.join(" "), adicionados.length ? "sucesso" : "erro");
    campo.focus();
  }

  async function participar() {
    const limpo = S.limparInstagram(campo.value);
    const normalizado = limpo.toLowerCase();
    campo.value = limpo;

    if (!normalizado) {
      mostrarMensagem("Digite o seu @ do Instagram.", "erro");
      campo.focus();
      return;
    }
    if (!S.instagramValido(normalizado)) {
      mostrarMensagem(S.traduzirErro({ message: "USUARIO_INVALIDO" }), "erro");
      campo.focus();
      return;
    }

    enviando = true;
    botao.disabled = true;
    textoBotao(botao, "ENVIANDO", true);
    esconderMensagem();

    let resposta;
    try {
      resposta = await S.db.rpc("participar", { p_username: limpo, p_dispositivo: dispositivo });
    } catch (erro) {
      resposta = { error: erro };
    }
    enviando = false;

    if (resposta.error) {
      if (S.codigoErro(resposta.error) === "DISPOSITIVO_JA_PARTICIPA" && (await conferirNoServidor())) {
        return; // formulário já foi bloqueado com o @ deste navegador
      }
      renderizarFormulario();
      mostrarMensagem(S.traduzirErro(resposta.error), "erro");
      campo.focus();
      return;
    }

    versao++;
    lista.adicionar(resposta.data);
    bloquear(resposta.data.instagram_username_normalizado);
    mostrarMensagem("Participação confirmada! Boa sorte.", "sucesso");
    campo.blur();
  }

  // =================================================================
  //  MODO ADMINISTRADOR (botão do cadeado)
  // =================================================================

  const botaoCadeado = $("botao-cadeado");
  const dialogo = $("dialogo-admin");
  const formSenha = $("form-senha");
  const campoSenha = $("campo-senha");
  const erroSenha = $("erro-senha");
  const botaoConfirmar = $("botao-confirmar");
  const botaoSortear = $("botao-sortear");
  const mensagemSorteio = $("mensagem-sorteio");
  let sorteando = false;

  function entrarNoAdmin(senha) {
    senhaAdmin = senha;
    S.salvarLocal(CHAVE_ADMIN, senha, true);
    document.body.classList.add("modo-admin");
    botaoCadeado.setAttribute("aria-label", "Sair do modo administrador");
    botaoCadeado.title = "Modo administrador ativo — clique para sair";
    lista.permitirExclusao(excluirParticipante);
    historico.modoAdmin(true);
    resultado.definirTextoVazio(["Pronto para sortear", "Clique em SORTEAR para escolher um participante."]);
    campo.value = "";
    esconderMensagem();
    renderizarFormulario(); // campo livre para adicionar quantos @ quiser
    sincronizacao.recarregar(); // busca o histórico completo
  }

  function sairDoAdmin() {
    senhaAdmin = null;
    S.apagarLocal(CHAVE_ADMIN, true);
    document.body.classList.remove("modo-admin");
    botaoCadeado.setAttribute("aria-label", "Acesso do administrador");
    botaoCadeado.title = "Acesso do administrador";
    mensagemSorteio.hidden = true;
    lista.permitirExclusao(null);
    historico.modoAdmin(false);
    resultado.definirTextoVazio(null);
    campo.value = "";
    esconderMensagem();
    renderizarFormulario(); // volta a valer "um @ por aparelho"
    sincronizacao.recarregar();
  }

  async function senhaConfere(senha) {
    const { data, error } = await S.db.rpc("verificar_senha_admin", { p_senha: senha });
    if (error) throw error;
    return data === true;
  }

  // Recarregou a página na mesma aba: continua como admin (se a senha ainda valer).
  const senhaGuardada = S.lerLocal(CHAVE_ADMIN, true);
  if (senhaGuardada) {
    senhaConfere(senhaGuardada)
      .then((ok) => (ok ? entrarNoAdmin(senhaGuardada) : S.apagarLocal(CHAVE_ADMIN, true)))
      .catch(() => {});
  }

  function abrirDialogo() {
    const sair = !!senhaAdmin;
    dialogo.classList.toggle("modo-sair", sair);
    textoBotao(botaoConfirmar, sair ? "SAIR" : "ENTRAR");
    botaoConfirmar.disabled = false;
    erroSenha.hidden = true;
    campoSenha.value = "";
    campoSenha.classList.remove("com-erro");
    if (typeof dialogo.showModal === "function") dialogo.showModal();
    else dialogo.setAttribute("open", "");
    if (!sair) setTimeout(() => campoSenha.focus(), 50);
  }

  function fecharDialogo() {
    if (typeof dialogo.close === "function") dialogo.close();
    else dialogo.removeAttribute("open");
  }

  botaoCadeado.addEventListener("click", abrirDialogo);
  $("botao-cancelar").addEventListener("click", fecharDialogo);
  dialogo.addEventListener("click", (e) => {
    if (e.target === dialogo) fecharDialogo(); // clique fora da janela
  });

  formSenha.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (senhaAdmin) {
      sairDoAdmin();
      fecharDialogo();
      return;
    }
    const senha = campoSenha.value;
    if (!senha) {
      erroSenha.textContent = "Digite a senha.";
      erroSenha.hidden = false;
      campoSenha.focus();
      return;
    }
    botaoConfirmar.disabled = true;
    textoBotao(botaoConfirmar, "CONFERINDO", true);
    let confere = false;
    let falha = null;
    try {
      confere = await senhaConfere(senha);
    } catch (erro) {
      falha = erro;
    }
    botaoConfirmar.disabled = false;
    textoBotao(botaoConfirmar, "ENTRAR");

    if (confere) {
      fecharDialogo();
      entrarNoAdmin(senha);
      return;
    }
    erroSenha.textContent = falha ? S.traduzirErro(falha) : "Senha incorreta.";
    erroSenha.hidden = false;
    campoSenha.classList.add("com-erro");
    campoSenha.select();
  });

  // Tratamento comum dos erros das ações de administrador.
  function falhaAdmin(erro) {
    if (S.codigoErro(erro) === "SENHA_INVALIDA") {
      sairDoAdmin();
      alert("A senha do administrador mudou ou expirou. Clique no cadeado e entre de novo.");
      return true;
    }
    return false;
  }

  botaoSortear.addEventListener("click", async () => {
    if (sorteando || !senhaAdmin) return;
    sorteando = true;
    botaoSortear.disabled = true;
    mensagemSorteio.hidden = true;

    let resposta;
    try {
      resposta = await S.db.rpc("sortear", { p_senha: senhaAdmin });
    } catch (erro) {
      resposta = { error: erro };
    }

    if (resposta.error) {
      if (!falhaAdmin(resposta.error)) {
        mensagemSorteio.textContent = S.traduzirErro(resposta.error);
        mensagemSorteio.hidden = false;
      }
    } else {
      // O sorteio já foi gravado no banco; todos os aparelhos recebem ao mesmo tempo.
      await sincronizacao.receberSorteio(resposta.data);
    }

    sorteando = false;
    botaoSortear.disabled = false;
  });

  async function excluirParticipante(p) {
    const usuario = "@" + p.instagram_username_normalizado;
    if (!confirm("Excluir " + usuario + " da lista de participantes?\n\nO histórico de sorteios é mantido e essa pessoa poderá se cadastrar de novo.")) return;
    const { error } = await S.db.rpc("excluir_participante", { p_senha: senhaAdmin, p_id: p.id });
    if (error) {
      if (!falhaAdmin(error)) alert(S.traduzirErro(error));
      return;
    }
    lista.remover(p.id);
  }

  $("botao-limpar-historico").addEventListener("click", async () => {
    if (!confirm("Apagar TODO o histórico de sorteios?\n\nOs participantes continuam cadastrados. Esta ação não pode ser desfeita.")) return;
    const { error } = await S.db.rpc("limpar_historico", { p_senha: senhaAdmin });
    if (error) {
      if (!falhaAdmin(error)) alert(S.traduzirErro(error));
      return;
    }
    sincronizacao.recarregar();
  });
})();
