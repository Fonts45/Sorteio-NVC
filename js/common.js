// =====================================================================
//  Sorteio Natu Vale — conexão com o banco e componentes da página
//  (lista de participantes, histórico, resultado com animação e
//  sincronização em tempo real). A lógica da página fica em app.js.
// =====================================================================
(function () {
  "use strict";

  const CFG = window.SORTEIO_CONFIG || {};
  const CHAVE_DISPOSITIVO = "natuvale_sorteio_dispositivo";
  const SORTEIO_RECENTE_MS = 90 * 1000; // sorteio visto "atrasado" ainda é animado
  const INTERVALO_RESERVA_MS = 15 * 1000; // leitura periódica se o tempo real cair

  // ---------------------------------------------------------------
  // @ do Instagram — mesma regra aplicada no banco (schema.sql)
  // ---------------------------------------------------------------

  function limparInstagram(texto) {
    return String(texto == null ? "" : texto)
      .replace(/[\s\p{Cf}]+/gu, "") // espaços e caracteres invisíveis
      .replace(/^(https?:\/\/)?(www\.)?(instagram\.com|instagr\.am)\//i, "")
      .replace(/^@+|[/?#].*$/g, "");
  }

  function normalizarInstagram(texto) {
    return limparInstagram(texto).toLowerCase();
  }

  function instagramValido(normalizado) {
    return /^[a-z0-9._]{1,30}$/.test(normalizado) && !/^\.|\.$|\.\./.test(normalizado);
  }

  // ---------------------------------------------------------------
  // Conexão: Supabase (real) ou modo demonstração (sem banco)
  // ---------------------------------------------------------------

  const configurado =
    /^https:\/\/[^/]+/.test(CFG.supabaseUrl || "") &&
    !!CFG.supabaseKey &&
    !/SEU-PROJETO|SUA-CHAVE/.test(CFG.supabaseUrl + CFG.supabaseKey);

  let db = null;
  if (configurado && window.supabase) {
    db = window.supabase.createClient(CFG.supabaseUrl.replace(/\/+$/, ""), CFG.supabaseKey, {
      auth: { persistSession: false },
    });
  } else if (!configurado && window.SorteioDemo) {
    db = window.SorteioDemo.criar({ limparInstagram, instagramValido });
  }
  const demonstracao = !!(db && db.demonstracao);

  // Avisos no topo da caixa: modo demonstração, ou falha ao carregar.
  function pronto() {
    const aviso = document.getElementById("aviso-config");
    if (db) {
      if (demonstracao && aviso) {
        aviso.className = "aviso aviso-demo";
        aviso.innerHTML =
          "<strong>Modo demonstração.</strong> Os dados ficam salvos só neste navegador. " +
          "Para o sorteio valer entre vários celulares, conecte o Supabase em <code>js/config.js</code> (veja o README).";
        aviso.hidden = false;
      }
      return true;
    }
    document.querySelectorAll("[data-requer-config]").forEach((el) => (el.hidden = true));
    if (aviso) {
      aviso.innerHTML =
        "<strong>Não foi possível carregar o sorteio.</strong><br>Verifique sua conexão com a internet e atualize a página.";
      aviso.hidden = false;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Mensagens de erro vindas do banco → texto amigável
  // ---------------------------------------------------------------

  const MENSAGENS = {
    USUARIO_INVALIDO: "Esse @ não parece válido. Use só letras, números, ponto e sublinhado.",
    USUARIO_JA_CADASTRADO: "Esse @ já está participando do sorteio.",
    DISPOSITIVO_JA_PARTICIPA: "Você já está participando deste sorteio.",
    DISPOSITIVO_INVALIDO: "Não foi possível identificar este navegador. Atualize a página e tente de novo.",
    SENHA_INVALIDA: "Senha incorreta.",
    SEM_PARTICIPANTES: "Ainda não há participantes para sortear.",
    LISTA_GRANDE_DEMAIS: "Envie no máximo 500 @ de cada vez.",
    NAO_AUTORIZADO: "Acesso negado pelo servidor. Confira a configuração do banco (schema.sql).",
  };

  function codigoErro(erro) {
    const texto = (erro && (erro.message || erro.error_description)) || "";
    const codigo = Object.keys(MENSAGENS).find((c) => texto.includes(c));
    if (codigo) return codigo;
    if ((erro && erro.code === "42501") || /permission denied/i.test(texto)) return "NAO_AUTORIZADO";
    return null;
  }

  function traduzirErro(erro) {
    const codigo = codigoErro(erro);
    if (codigo) return MENSAGENS[codigo];
    const texto = (erro && erro.message) || "";
    if (/fetch|network|load failed|conex/i.test(texto) || !navigator.onLine) {
      return "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
    }
    return "Algo deu errado. Tente novamente em instantes.";
  }

  // ---------------------------------------------------------------
  // Armazenamento local (com proteção para navegadores restritos)
  // ---------------------------------------------------------------

  function lerLocal(chave, sessao) {
    try { return (sessao ? sessionStorage : localStorage).getItem(chave); } catch (e) { return null; }
  }
  function salvarLocal(chave, valor, sessao) {
    try { (sessao ? sessionStorage : localStorage).setItem(chave, valor); } catch (e) { /* modo privado */ }
  }
  function apagarLocal(chave, sessao) {
    try { (sessao ? sessionStorage : localStorage).removeItem(chave); } catch (e) { /* modo privado */ }
  }
  function lerCookie(chave) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + chave + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function salvarCookie(chave, valor) {
    const seguro = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = chave + "=" + encodeURIComponent(valor) + "; max-age=" + 400 * 86400 + "; path=/; SameSite=Lax" + seguro;
  }

  function gerarUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // Identificação persistente deste navegador: guardada no localStorage
  // e num cookie (se um for apagado, o outro recupera).
  function obterDispositivo() {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let id = lerLocal(CHAVE_DISPOSITIVO);
    if (!uuid.test(id || "")) id = lerCookie(CHAVE_DISPOSITIVO);
    if (!uuid.test(id || "")) id = gerarUuid();
    salvarLocal(CHAVE_DISPOSITIVO, id);
    salvarCookie(CHAVE_DISPOSITIVO, id);
    return id;
  }

  // ---------------------------------------------------------------
  // Formatação
  // ---------------------------------------------------------------

  const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function formatarDataHora(iso) {
    const d = new Date(iso);
    return fmtData.format(d) + " às " + fmtHora.format(d);
  }

  function formatarNumero(n) {
    return Number(n).toLocaleString("pt-BR");
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const movimentoReduzido = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------
  // Leitura do banco
  // ---------------------------------------------------------------

  async function carregarParticipantes() {
    const PAGINA = 1000; // limite padrão por requisição no Supabase
    const todos = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await db
        .from("participantes")
        .select("id, instagram_username_normalizado, criado_em")
        .order("id", { ascending: false })
        .range(de, de + PAGINA - 1);
      if (error) throw error;
      todos.push(...data);
      if (data.length < PAGINA) return todos;
    }
  }

  // Público: os 10 últimos sorteios (o banco não entrega mais que isso).
  async function carregarUltimosSorteios() {
    const { data, error } = await db
      .from("sorteios")
      .select("id, instagram_username, total_participantes, sorteado_em")
      .order("id", { ascending: false })
      .limit(10);
    if (error) throw error;
    return data;
  }

  // ---------------------------------------------------------------
  // Componente: lista de participantes
  // ---------------------------------------------------------------

  function ListaParticipantes(opcoes) {
    const { elLista, elContador, elBusca, elVazio } = opcoes;
    const mapa = new Map();
    let filtro = "";
    let meu = null;
    let carregado = false;
    let onExcluir = null;

    function criarItem(p, novo) {
      const li = document.createElement("li");
      li.className = "participante" + (novo ? " novo" : "") + (p.instagram_username_normalizado === meu ? " meu" : "");
      li.dataset.id = p.id;
      const nome = document.createElement("span");
      nome.className = "nome";
      nome.textContent = "@" + p.instagram_username_normalizado;
      nome.title = p.instagram_username_normalizado === meu ? "Você" : "@" + p.instagram_username_normalizado;
      li.appendChild(nome);
      if (onExcluir) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "excluir";
        b.textContent = "×";
        b.setAttribute("aria-label", "Excluir @" + p.instagram_username_normalizado);
        b.title = "Excluir participante";
        b.addEventListener("click", () => onExcluir(p));
        li.appendChild(b);
      }
      return li;
    }

    const visivel = (p) => !filtro || p.instagram_username_normalizado.includes(filtro);

    function atualizarResumo(animar) {
      const total = mapa.size;
      if (elContador.textContent !== formatarNumero(total)) {
        elContador.textContent = formatarNumero(total);
        if (animar) {
          elContador.classList.remove("pulo");
          void elContador.offsetWidth;
          elContador.classList.add("pulo");
        }
      }
      if (elBusca) elBusca.hidden = total < 12 && !filtro;
      if (elVazio && carregado) {
        elVazio.hidden = !!elLista.firstElementChild;
        elVazio.textContent = total === 0 ? elVazio.dataset.vazio : "Nenhum @ encontrado.";
      }
    }

    function renderizar() {
      const frag = document.createDocumentFragment();
      [...mapa.values()]
        .sort((a, b) => b.id - a.id)
        .forEach((p) => visivel(p) && frag.appendChild(criarItem(p, false)));
      elLista.replaceChildren(frag);
      atualizarResumo(false);
    }

    if (elBusca) {
      elBusca.addEventListener("input", () => {
        filtro = normalizarInstagram(elBusca.value);
        renderizar();
      });
    }

    return {
      definir(lista) {
        mapa.clear();
        lista.forEach((p) => mapa.set(p.id, p));
        carregado = true;
        renderizar();
      },
      adicionar(p) {
        if (mapa.has(p.id)) return;
        mapa.set(p.id, p);
        if (visivel(p)) elLista.prepend(criarItem(p, true));
        atualizarResumo(true);
      },
      remover(id) {
        const p = mapa.get(id);
        if (!p) return;
        mapa.delete(id);
        const li = elLista.querySelector('[data-id="' + id + '"]');
        if (li) li.remove();
        atualizarResumo(true);
        if (opcoes.onRemovido) opcoes.onRemovido(p);
      },
      marcarMeu(usuario) {
        meu = usuario;
        renderizar();
      },
      // Modo administrador: mostra o botão × em cada participante.
      permitirExclusao(funcao) {
        onExcluir = funcao || null;
        renderizar();
      },
      nomes: () => [...mapa.values()].map((p) => p.instagram_username_normalizado),
    };
  }

  // ---------------------------------------------------------------
  // Componente: histórico de sorteios
  // ---------------------------------------------------------------

  function Historico(opcoes) {
    const { elLista, elSecao, elVazio } = opcoes;
    let itens = [];
    const ocultos = new Set(); // sorteios ainda em animação (não revelar antes da hora)
    let novoId = null;
    let admin = false; // admin: histórico completo, com totais e seção sempre visível

    function renderizar() {
      const visiveis = itens.filter((s) => !ocultos.has(s.id)).slice(0, admin ? Infinity : 10);
      const frag = document.createDocumentFragment();
      visiveis.forEach((s, i) => {
        const li = document.createElement("li");
        if (s.id === novoId) li.className = "novo";
        const pos = document.createElement("span");
        pos.className = "pos";
        pos.textContent = String(i + 1);
        const usuario = document.createElement("span");
        usuario.className = "usuario";
        usuario.textContent = "@" + s.instagram_username;
        const quando = document.createElement("time");
        quando.dateTime = s.sorteado_em;
        quando.textContent = formatarDataHora(s.sorteado_em);
        if (admin) {
          const total = document.createElement("span");
          total.className = "total";
          total.textContent = "entre " + formatarNumero(s.total_participantes) + " participantes";
          quando.appendChild(total);
        }
        li.append(pos, usuario, quando);
        frag.appendChild(li);
      });
      elLista.replaceChildren(frag);
      elLista.classList.toggle("rolavel", admin);
      novoId = null;
      elSecao.hidden = !admin && visiveis.length === 0;
      elVazio.hidden = !admin || visiveis.length > 0;
    }

    function ordenar() {
      itens.sort((a, b) => b.id - a.id);
    }

    return {
      definir(lista) {
        itens = lista.slice();
        ordenar();
        renderizar();
      },
      ocultar(id) {
        ocultos.add(id);
        renderizar();
      },
      revelar(s) {
        ocultos.delete(s.id);
        if (!itens.some((x) => x.id === s.id)) itens.push(s);
        ordenar();
        novoId = s.id;
        renderizar();
      },
      remover(id) {
        itens = itens.filter((s) => s.id !== id);
        renderizar();
      },
      modoAdmin(ativo) {
        admin = ativo;
        renderizar();
      },
    };
  }

  // ---------------------------------------------------------------
  // Componente: resultado do sorteio (com animação)
  // ---------------------------------------------------------------

  function Resultado(opcoes) {
    const { el } = opcoes;
    const elTitulo = el.querySelector(".resultado-titulo");
    const elNome = el.querySelector(".resultado-nome");
    const elInfo = el.querySelector(".resultado-info");
    const elAnuncio = opcoes.elAnuncio;
    let textoVazio = null; // [título, texto] exibidos quando não há sorteio (modo admin)
    let ultimoId = 0;
    let emAnimacao = 0;
    let fila = Promise.resolve();

    function preencher(s) {
      el.classList.remove("vazio", "girando");
      elTitulo.textContent = "🎉 SORTEADO 🎉";
      elNome.textContent = "@" + s.instagram_username;
      elInfo.textContent = formatarDataHora(s.sorteado_em) + " · entre " + formatarNumero(s.total_participantes) + " participantes";
      el.hidden = false;
    }

    function limpar() {
      ultimoId = 0;
      el.classList.remove("girando", "revelado");
      if (textoVazio) {
        el.classList.add("vazio");
        elTitulo.textContent = textoVazio[0];
        elNome.textContent = "";
        elInfo.textContent = textoVazio[1];
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    }

    async function girar(s, nomes) {
      el.classList.remove("vazio", "revelado");
      el.classList.add("girando");
      el.hidden = false;
      elTitulo.textContent = "Sorteando…";
      elInfo.textContent = "Boa sorte a todos!";
      if (opcoes.rolarAteResultado) el.scrollIntoView({ behavior: movimentoReduzido() ? "auto" : "smooth", block: "center" });

      // Aba em segundo plano: o navegador atrasa os timers, então pula o giro.
      const duracao = document.hidden ? 0 : movimentoReduzido() ? 700 : 3800;
      const lista = nomes.length ? nomes : [s.instagram_username];
      const inicio = performance.now();
      let atraso = 55;
      let anterior = "";
      while (performance.now() - inicio < duracao) {
        let nome = lista[Math.floor(Math.random() * lista.length)];
        if (lista.length > 1 && nome === anterior) nome = lista[(lista.indexOf(nome) + 1) % lista.length];
        anterior = nome;
        elNome.textContent = "@" + nome;
        await esperar(atraso);
        atraso = Math.min(atraso * 1.09, 420);
      }

      preencher(s);
      void el.offsetWidth;
      el.classList.add("revelado");
      if (elAnuncio) elAnuncio.textContent = "Sorteado: @" + s.instagram_username;
      confete(el);
      await esperar(700);
    }

    return {
      ultimoId: () => ultimoId,
      animando: () => emAnimacao > 0,
      aguardar: () => fila, // termina quando todas as animações da fila acabarem
      mostrar(s) {
        ultimoId = s.id;
        el.classList.remove("revelado");
        preencher(s);
      },
      limpar,
      definirTextoVazio(texto) {
        textoVazio = texto;
        if (!ultimoId && !emAnimacao) limpar();
      },
      // Enfileira: se chegarem dois sorteios seguidos, um anima depois do outro.
      animar(s, obterNomes) {
        ultimoId = Math.max(ultimoId, s.id);
        emAnimacao++;
        const vez = fila.then(() => girar(s, obterNomes()));
        fila = vez.catch(() => {});
        return vez.finally(() => emAnimacao--);
      },
    };
  }

  function confete(origem) {
    if (movimentoReduzido() || !Element.prototype.animate) return;
    const cores = ["#215037", "#2f7a52", "#75AD49", "#99CC33", "#E2C35C", "#F0ECE5"];
    const camada = document.createElement("div");
    camada.className = "confete";
    camada.setAttribute("aria-hidden", "true");
    document.body.appendChild(camada);
    const r = origem.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 90; i++) {
      const p = document.createElement("i");
      p.style.background = cores[i % cores.length];
      p.style.left = cx + "px";
      p.style.top = cy + "px";
      camada.appendChild(p);
      const ang = Math.random() * Math.PI * 2;
      const dist = 90 + Math.random() * 230;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.8 - 110;
      p.animate(
        [
          { transform: "translate(-50%,-50%) rotate(0deg) scale(.6)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 540}deg) scale(1)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${dx * 1.2}px, ${dy + 340}px) rotate(${Math.random() * 1000}deg) scale(1)`, opacity: 0 },
        ],
        { duration: 1700 + Math.random() * 1000, easing: "cubic-bezier(.12,.75,.3,1)", fill: "forwards" }
      );
    }
    setTimeout(() => camada.remove(), 3000);
  }

  // ---------------------------------------------------------------
  // Sincronização: carga inicial + tempo real + plano B
  // ---------------------------------------------------------------

  function iniciarSincronizacao(opcoes) {
    const { lista, historico, resultado, elStatus, carregarSorteios } = opcoes;
    let emCurso = null;
    let repetir = false;
    let carregouUmaVez = false;
    let temporizadorReserva = null;
    let temporizadorDebounce = null;

    function status(estado) {
      if (!elStatus) return;
      elStatus.className = "ao-vivo " + estado;
      elStatus.textContent = estado === "online" ? "ao vivo" : estado === "offline" ? "reconectando…" : "conectando…";
    }

    // O mesmo sorteio pode chegar duas vezes (resposta do sortear() e aviso
    // em tempo real, em qualquer ordem): só a primeira anima.
    function receberSorteio(s) {
      if (s.id <= resultado.ultimoId()) return resultado.aguardar();
      historico.ocultar(s.id);
      return resultado.animar(s, lista.nomes).then(() => historico.revelar(s));
    }

    async function recarregar() {
      if (emCurso) {
        repetir = true;
        return emCurso;
      }
      emCurso = (async () => {
        do {
          repetir = false;
          try {
            const [participantes, sorteios] = await Promise.all([carregarParticipantes(), carregarSorteios()]);
            lista.definir(participantes);
            const recente = sorteios[0];
            const pendente = recente && recente.id > resultado.ultimoId();
            if (pendente) historico.ocultar(recente.id);
            historico.definir(sorteios);
            if (!recente) {
              if (!resultado.animando()) resultado.limpar();
            } else if (pendente && carregouUmaVez && Date.now() - Date.parse(recente.sorteado_em) < SORTEIO_RECENTE_MS) {
              receberSorteio(recente); // perdeu o aviso em tempo real: anima mesmo assim
            } else if (recente.id !== resultado.ultimoId() && !resultado.animando()) {
              resultado.mostrar(recente);
              historico.revelar(recente);
            } else if (pendente) {
              historico.revelar(recente);
            }
            carregouUmaVez = true;
          } catch (erro) {
            console.error("[sorteio] falha ao carregar dados:", erro);
            if (opcoes.onErro) opcoes.onErro(erro);
          }
        } while (repetir);
        emCurso = null;
      })();
      return emCurso;
    }

    function recarregarEmBreve() {
      clearTimeout(temporizadorDebounce);
      temporizadorDebounce = setTimeout(recarregar, 400);
    }

    function ligarReserva(ligar) {
      clearInterval(temporizadorReserva);
      temporizadorReserva = ligar ? setInterval(recarregar, INTERVALO_RESERVA_MS) : null;
    }

    status("conectando");
    recarregar();

    db.channel("sorteio-natuvale")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "participantes" }, (m) => lista.adicionar(m.new))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "participantes" }, (m) => lista.remover(m.old.id))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sorteios" }, (m) => receberSorteio(m.new))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "sorteios" }, (m) => {
        historico.remover(m.old.id);
        recarregarEmBreve();
      })
      .subscribe((estado) => {
        if (estado === "SUBSCRIBED") {
          status("online");
          ligarReserva(false);
          recarregar(); // (re)conectou: busca o que possa ter chegado antes da conexão
        } else if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") {
          status("offline");
          ligarReserva(true);
        }
      });

    // Celulares suspendem a conexão com a tela apagada: ao voltar, atualiza.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") recarregar();
    });
    window.addEventListener("online", recarregar);

    return { recarregar, receberSorteio };
  }

  window.Sorteio = {
    db,
    demonstracao,
    pronto,
    limparInstagram,
    normalizarInstagram,
    instagramValido,
    codigoErro,
    traduzirErro,
    lerLocal,
    salvarLocal,
    apagarLocal,
    obterDispositivo,
    formatarDataHora,
    carregarUltimosSorteios,
    ListaParticipantes,
    Historico,
    Resultado,
    iniciarSincronizacao,
  };
})();
