// =====================================================================
//  MODO DEMONSTRAÇÃO — usado automaticamente enquanto js/config.js não
//  tiver os dados do Supabase (por exemplo, no GitHub Pages sem banco).
//
//  Imita as mesmas funções do banco real, mas guarda tudo NESTE
//  navegador (localStorage). Serve para ver e testar o site; os dados
//  NÃO são compartilhados entre celulares. Para o sorteio valer para
//  todo mundo, configure o Supabase (veja o README).
// =====================================================================
(function () {
  "use strict";

  const CHAVE = "natuvale_sorteio_demo";

  // Senha do modo demonstração, guardada só como hash PBKDF2-SHA256.
  // (No modo real a senha é conferida pelo banco: supabase/schema.sql.)
  const SENHA = {
    sal: "b2f7358c386f8cf8693979e0f6450943",
    iteracoes: 300000,
    hash: "b3ecb30d72eb24cdcb175327e345e4aaa009fb7b3f06b7bd7f457f2278910ce6",
  };

  function criar(ajuda) {
    const canalAbas = "BroadcastChannel" in window ? new BroadcastChannel(CHAVE) : null;
    const ouvintes = [];

    function ler() {
      let d = null;
      try {
        d = JSON.parse(localStorage.getItem(CHAVE));
      } catch (e) { /* sem armazenamento: começa vazio */ }
      if (!d || !d.participantes) d = { participantes: [], dispositivos: [], sorteios: [], seq: { p: 0, s: 0, n: 0 } };
      // Dados de uma versão anterior sem o número do sorteio: numera por ordem de cadastro.
      if (d.seq.n === undefined) {
        d.seq.n = 0;
        d.participantes.sort((a, b) => a.id - b.id).forEach((p) => (p.numero = ++d.seq.n));
      }
      return d;
    }
    function gravar(d) {
      try { localStorage.setItem(CHAVE, JSON.stringify(d)); } catch (e) { /* modo privado */ }
    }

    // "Tempo real" entre abas do mesmo navegador.
    function entregar(msg) {
      ouvintes.forEach((o) => {
        if (o.table === msg.table && (o.event === "*" || o.event === msg.eventType)) {
          setTimeout(() => o.cb({ eventType: msg.eventType, new: msg.new, old: msg.old }), 0);
        }
      });
    }
    function avisar(msg) {
      if (canalAbas) canalAbas.postMessage(msg);
      entregar(msg);
    }
    if (canalAbas) canalAbas.onmessage = (e) => entregar(e.data);
    window.addEventListener("storage", (e) => {
      if (e.key === CHAVE) ouvintes.forEach((o) => o.onRecarga && o.onRecarga());
    });

    const ok = (data) => Promise.resolve({ data, error: null });
    const erro = (message, code) => Promise.resolve({ data: null, error: { message, code: code || "P0001" } });

    const hexParaBytes = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));
    const bytesParaHex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

    async function senhaConfere(senha) {
      if (!senha || !window.crypto || !crypto.subtle) return false;
      const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: hexParaBytes(SENHA.sal), iterations: SENHA.iteracoes },
        chave,
        256
      );
      return bytesParaHex(bits) === SENHA.hash;
    }

    const rpcs = {
      participar({ p_username, p_dispositivo }) {
        const d = ler();
        if (!p_dispositivo) return erro("DISPOSITIVO_INVALIDO");
        const limpo = ajuda.limparInstagram(p_username);
        const normalizado = limpo.toLowerCase();
        if (!ajuda.instagramValido(normalizado)) return erro("USUARIO_INVALIDO");
        if (d.dispositivos.some((x) => x.dispositivo_id === p_dispositivo)) return erro("DISPOSITIVO_JA_PARTICIPA");
        if (d.participantes.some((x) => x.instagram_username_normalizado === normalizado)) return erro("USUARIO_JA_CADASTRADO");
        const novo = {
          id: ++d.seq.p,
          numero: ++d.seq.n, // mesmo contador do banco real: nunca volta atrás
          instagram_username: limpo,
          instagram_username_normalizado: normalizado,
          criado_em: new Date().toISOString(),
        };
        d.participantes.push(novo);
        d.dispositivos.push({ dispositivo_id: p_dispositivo, participante_id: novo.id });
        gravar(d);
        avisar({ table: "participantes", eventType: "INSERT", new: novo, old: {} });
        return ok(novo);
      },

      minha_participacao({ p_dispositivo }) {
        const d = ler();
        const disp = d.dispositivos.find((x) => x.dispositivo_id === p_dispositivo);
        const p = disp && d.participantes.find((x) => x.id === disp.participante_id);
        return ok(p ? [{ usuario: p.instagram_username_normalizado, numero: p.numero }] : []);
      },

      async verificar_senha_admin({ p_senha }) {
        return ok(await senhaConfere(p_senha));
      },

      async adicionar_participantes_admin({ p_senha, p_usernames }) {
        if (!(await senhaConfere(p_senha))) return erro("SENHA_INVALIDA", "42501");
        const entradas = p_usernames || [];
        if (entradas.length > 500) return erro("LISTA_GRANDE_DEMAIS");
        const d = ler();
        const vistos = new Set();
        const novos = [];
        const linhas = entradas.map((entrada) => {
          const limpo = ajuda.limparInstagram(entrada);
          const usuario = limpo.toLowerCase();
          const linha = { entrada, usuario, situacao: "", participante_id: null, cadastrado_em: null, numero: null };
          if (!ajuda.instagramValido(usuario)) {
            linha.situacao = "USUARIO_INVALIDO";
            return linha;
          }
          if (vistos.has(usuario)) {
            linha.situacao = "REPETIDO";
            return linha;
          }
          vistos.add(usuario);
          if (d.participantes.some((x) => x.instagram_username_normalizado === usuario)) {
            linha.situacao = "USUARIO_JA_CADASTRADO";
            return linha;
          }
          const novo = { id: ++d.seq.p, numero: ++d.seq.n, instagram_username: limpo, instagram_username_normalizado: usuario, criado_em: new Date().toISOString() };
          d.participantes.push(novo);
          novos.push(novo);
          Object.assign(linha, { situacao: "ADICIONADO", participante_id: novo.id, cadastrado_em: novo.criado_em, numero: novo.numero });
          return linha;
        });
        gravar(d);
        novos.forEach((novo) => avisar({ table: "participantes", eventType: "INSERT", new: novo, old: {} }));
        return ok(linhas);
      },

      async sortear({ p_senha }) {
        if (!(await senhaConfere(p_senha))) return erro("SENHA_INVALIDA", "42501");
        const d = ler();
        if (!d.participantes.length) return erro("SEM_PARTICIPANTES");
        const sorte = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
        const v = d.participantes[Math.floor(sorte * d.participantes.length)];
        const s = {
          id: ++d.seq.s,
          participante_id: v.id,
          numero: v.numero,
          instagram_username: v.instagram_username_normalizado,
          total_participantes: d.participantes.length,
          sorteado_em: new Date().toISOString(),
        };
        d.sorteios.push(s);
        gravar(d);
        avisar({ table: "sorteios", eventType: "INSERT", new: s, old: {} });
        return ok(s);
      },

      async historico_completo({ p_senha }) {
        if (!(await senhaConfere(p_senha))) return erro("SENHA_INVALIDA", "42501");
        return ok(ler().sorteios.slice().sort((a, b) => b.id - a.id));
      },

      async excluir_participante({ p_senha, p_id }) {
        if (!(await senhaConfere(p_senha))) return erro("SENHA_INVALIDA", "42501");
        const d = ler();
        const existia = d.participantes.some((x) => x.id === p_id);
        d.participantes = d.participantes.filter((x) => x.id !== p_id);
        d.dispositivos = d.dispositivos.filter((x) => x.participante_id !== p_id);
        d.sorteios.forEach((s) => { if (s.participante_id === p_id) s.participante_id = null; });
        gravar(d);
        if (existia) avisar({ table: "participantes", eventType: "DELETE", new: {}, old: { id: p_id } });
        return ok(existia);
      },

      async excluir_todos_participantes({ p_senha }) {
        if (!(await senhaConfere(p_senha))) return erro("SENHA_INVALIDA", "42501");
        const d = ler();
        const apagados = d.participantes;
        d.participantes = [];
        d.dispositivos = [];
        d.sorteios.forEach((s) => (s.participante_id = null));
        d.seq.n = 0; // números recomeçam do Nº 1
        gravar(d);
        apagados.forEach((p) => avisar({ table: "participantes", eventType: "DELETE", new: {}, old: { id: p.id } }));
        return ok(apagados.length);
      },

      async limpar_historico({ p_senha }) {
        if (!(await senhaConfere(p_senha))) return erro("SENHA_INVALIDA", "42501");
        const d = ler();
        const apagados = d.sorteios;
        d.sorteios = [];
        gravar(d);
        apagados.forEach((s) => avisar({ table: "sorteios", eventType: "DELETE", new: {}, old: { id: s.id } }));
        return ok(apagados.length);
      },
    };

    function rpc(nome, params) {
      const f = rpcs[nome];
      return f ? Promise.resolve(f(params || {})) : erro("Função desconhecida: " + nome);
    }

    // Consultas de leitura usadas pelo site: select → order → range/limit.
    function from(tabela) {
      const c = { de: 0, ate: Infinity };
      const consulta = {
        select: () => consulta,
        order: () => consulta, // sempre id decrescente, como o site pede
        range: (de, ate) => { c.de = de; c.ate = ate; return consulta; },
        limit: (n) => { c.ate = n - 1; return consulta; },
        then(resolver, rejeitar) {
          let linhas = (ler()[tabela] || []).slice().sort((a, b) => b.id - a.id);
          if (tabela === "sorteios") linhas = linhas.slice(0, 10); // mesma regra do banco real
          return ok(linhas.slice(c.de, c.ate + 1)).then(resolver, rejeitar);
        },
      };
      return consulta;
    }

    function channel() {
      const registrados = [];
      const canal = {
        on(_tipo, filtro, cb) {
          registrados.push({ table: filtro.table, event: filtro.event, cb });
          return canal;
        },
        subscribe(cb) {
          registrados.forEach((r) => ouvintes.push(r));
          // Mudança feita em outra aba sem BroadcastChannel: recarrega tudo.
          if (!canalAbas) ouvintes.push({ onRecarga: () => cb("SUBSCRIBED") });
          setTimeout(() => cb("SUBSCRIBED"), 0);
          return canal;
        },
      };
      return canal;
    }

    return { from, rpc, channel, demonstracao: true };
  }

  window.SorteioDemo = { criar };
})();
