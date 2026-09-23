-- =====================================================================
--  SORTEIO NATU VALE — estrutura do banco (Supabase / PostgreSQL)
--
--  Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo
--  → Run. Pode ser executado novamente sem perder dados.
--
--  Regras de segurança aplicadas aqui (e não no navegador):
--   • @ único no banco (UNIQUE em instagram_username_normalizado);
--   • um cadastro por navegador/dispositivo (PRIMARY KEY em dispositivo_id);
--   • cadastro só pela função participar(), que normaliza e valida o @;
--   • sortear, excluir e limpar exigem a senha do administrador, conferida
--     aqui no banco (o site não guarda a senha, só a envia para conferência);
--   • visitantes só LEEM participantes e os últimos 10 sorteios.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;


-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

create table if not exists public.participantes (
  id                              bigint generated always as identity primary key,
  instagram_username              text        not null,
  instagram_username_normalizado  text        not null,
  criado_em                       timestamptz not null default now(),

  constraint participantes_username_normalizado_key unique (instagram_username_normalizado),
  constraint participantes_username_formato check (
    instagram_username_normalizado ~ '^[a-z0-9._]{1,30}$'
    and instagram_username_normalizado !~ '^\.|\.$|\.\.'
  ),
  constraint participantes_username_coerente check (
    instagram_username_normalizado = lower(instagram_username)
  )
);

create index if not exists participantes_criado_em_idx on public.participantes (criado_em desc);

-- Número do participante no sorteio (1, 2, 3…), na ordem de cadastro.
-- É distribuído sem "buracos" e nunca muda, mesmo se alguém for excluído.
alter table public.participantes add column if not exists numero integer;

with base as (select coalesce(max(numero), 0) as maximo from public.participantes),
     sem_numero as (select id, row_number() over (order by id) as ordem
                      from public.participantes where numero is null)
update public.participantes p
   set numero = base.maximo + sem_numero.ordem
  from base, sem_numero
 where p.id = sem_numero.id;

alter table public.participantes alter column numero set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'participantes_numero_key') then
    alter table public.participantes add constraint participantes_numero_key unique (numero);
  end if;
end;
$$;

-- Contador do último número entregue. Nunca volta atrás: o número de quem
-- for excluído não é reaproveitado. (Zerado só por supabase/zerar-sorteio.sql)
create table if not exists public.contador_numero (
  id      integer primary key default 1 check (id = 1),
  ultimo  integer not null default 0
);

insert into public.contador_numero (id, ultimo)
values (1, (select coalesce(max(numero), 0) from public.participantes))
on conflict (id) do update
  set ultimo = greatest(public.contador_numero.ultimo, excluded.ultimo);

-- Identificador persistente de cada navegador. Fica em tabela separada
-- (e sem acesso público) para que ninguém consiga ler os IDs pela API.
create table if not exists public.dispositivos (
  dispositivo_id   uuid        primary key,
  participante_id  bigint      not null unique references public.participantes (id) on delete cascade,
  criado_em        timestamptz not null default now()
);

create table if not exists public.sorteios (
  id                   bigint generated always as identity primary key,
  participante_id      bigint      references public.participantes (id) on delete set null,
  instagram_username   text        not null,
  total_participantes  integer     not null,
  sorteado_em          timestamptz not null default now()
);

create index if not exists sorteios_sorteado_em_idx on public.sorteios (sorteado_em desc);

-- O sorteio guarda o número do vencedor (fica no histórico mesmo se ele for excluído).
alter table public.sorteios add column if not exists numero integer;

-- Senha do administrador, guardada só como hash bcrypt (nunca em texto).
-- Senha inicial: a combinada para o sorteio. Para trocar: supabase/trocar-senha.sql
create table if not exists public.configuracao_admin (
  id          integer primary key default 1 check (id = 1),
  senha_hash  text    not null
);

insert into public.configuracao_admin (id, senha_hash)
values (1, '$2a$10$KnHHq.wQvXy.vkqD.HmLU.yOUo.r0zUYcon5ZbSqdI1DpPt8ybe9S')
on conflict (id) do nothing;   -- rodar de novo não desfaz uma troca de senha


-- ---------------------------------------------------------------------
-- 1b. LIMPEZA DA VERSÃO ANTERIOR (login por e-mail) — inofensivo se não existir
-- ---------------------------------------------------------------------

drop policy if exists "Admin exclui participantes"     on public.participantes;
drop policy if exists "Admin exclui sorteios"          on public.sorteios;
drop policy if exists "Público vê os últimos sorteios" on public.sorteios;
drop function if exists public.sortear();
drop function if exists public.is_admin();
drop table if exists public.admins;
-- (versão sem o número do sorteio no retorno; é recriada abaixo)
drop function if exists public.adicionar_participantes_admin(text, text[]);


-- ---------------------------------------------------------------------
-- 2. FUNÇÕES
-- ---------------------------------------------------------------------

-- Limpa o que a pessoa digitou: remove espaços (inclusive invisíveis),
-- @ iniciais e, se colarem o link do perfil, extrai só o usuário.
-- "  @Rodrigo " → "Rodrigo"   |   "instagram.com/rodrigo/" → "rodrigo"
create or replace function public.limpar_instagram(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p_texto, ''), '[[:space:]' || chr(8203) || '-' || chr(8205) || chr(8288) || chr(65279) || ']+', '', 'g'),
        '^(https?://)?(www\.)?(instagram\.com|instagr\.am)/', '', 'i'
      ),
      '^@+|[/?#].*$', '', 'g'
    ),
    ''
  );
$$;

-- Regras do Instagram: letras, números, ponto e sublinhado; até 30
-- caracteres; sem ponto no início, no fim ou dois pontos seguidos.
create or replace function public.instagram_valido(p_normalizado text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_normalizado ~ '^[a-z0-9._]{1,30}$' and p_normalizado !~ '^\.|\.$|\.\.',
    false
  );
$$;

-- Próximo número do sorteio. A linha do contador fica travada até o fim do
-- cadastro: com várias pessoas no mesmo segundo, cada uma recebe o seu
-- número, sem repetir. Se o cadastro falhar, o contador volta junto
-- (desfeito pela transação), então nenhum número é pulado.
create or replace function public.proximo_numero()
returns integer
language sql
volatile
set search_path = ''
as $$
  update public.contador_numero set ultimo = ultimo + 1 where id = 1 returning ultimo;
$$;

-- A senha do administrador confere? (usada pelo botão do cadeado)
create or replace function public.verificar_senha_admin(p_senha text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select senha_hash = extensions.crypt(coalesce(p_senha, ''), senha_hash)
       from public.configuracao_admin
      where id = 1),
    false
  );
$$;

-- IDs dos 10 sorteios mais recentes (o que o público pode ver).
create or replace function public.ultimos_sorteios_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.sorteios order by sorteado_em desc, id desc limit 10;
$$;

-- Cadastro de participante. Toda a validação acontece aqui, no servidor.
-- Erros devolvidos (o site traduz para mensagens amigáveis):
--   USUARIO_INVALIDO, USUARIO_JA_CADASTRADO, DISPOSITIVO_INVALIDO, DISPOSITIVO_JA_PARTICIPA
create or replace function public.participar(p_username text, p_dispositivo uuid)
returns public.participantes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limpo       text;
  v_normalizado text;
  v_novo        public.participantes;
  v_restricao   text;
begin
  if p_dispositivo is null then
    raise exception 'DISPOSITIVO_INVALIDO';
  end if;

  v_limpo       := public.limpar_instagram(p_username);
  v_normalizado := lower(v_limpo);

  if not public.instagram_valido(v_normalizado) then
    raise exception 'USUARIO_INVALIDO';
  end if;

  if exists (select 1 from public.dispositivos where dispositivo_id = p_dispositivo) then
    raise exception 'DISPOSITIVO_JA_PARTICIPA';
  end if;

  -- As restrições UNIQUE garantem a regra mesmo com cadastros simultâneos.
  begin
    insert into public.participantes (instagram_username, instagram_username_normalizado, numero)
    values (v_limpo, v_normalizado, public.proximo_numero())
    returning * into v_novo;

    insert into public.dispositivos (dispositivo_id, participante_id)
    values (p_dispositivo, v_novo.id);
  exception when unique_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'participantes_username_normalizado_key' then
      raise exception 'USUARIO_JA_CADASTRADO';
    end if;
    raise exception 'DISPOSITIVO_JA_PARTICIPA';
  end;

  return v_novo;
end;
$$;

-- Administrador adiciona quantos @ quiser (exige a senha), um ou vários de
-- uma vez. Não usa o limite de "um por aparelho", mas o @ continua único.
-- Devolve uma linha por @ enviado, com a situação:
--   ADICIONADO, USUARIO_JA_CADASTRADO, USUARIO_INVALIDO ou REPETIDO (na própria lista)
create or replace function public.adicionar_participantes_admin(p_senha text, p_usernames text[])
returns table (entrada text, usuario text, situacao text, participante_id bigint, cadastrado_em timestamptz, numero integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrada text;
  v_limpo   text;
  v_vistos  text[] := '{}';
  v_novo    public.participantes;
begin
  if not public.verificar_senha_admin(p_senha) then
    raise exception 'SENHA_INVALIDA' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_usernames), 0) > 500 then
    raise exception 'LISTA_GRANDE_DEMAIS';
  end if;

  foreach v_entrada in array coalesce(p_usernames, '{}'::text[]) loop
    v_limpo         := public.limpar_instagram(v_entrada);
    entrada         := v_entrada;
    usuario         := lower(v_limpo);
    participante_id := null;
    cadastrado_em   := null;
    numero          := null;

    if not public.instagram_valido(usuario) then
      situacao := 'USUARIO_INVALIDO';
    elsif usuario = any (v_vistos) then
      situacao := 'REPETIDO';
    else
      v_vistos := v_vistos || usuario;
      begin
        insert into public.participantes (instagram_username, instagram_username_normalizado, numero)
        values (v_limpo, usuario, public.proximo_numero())
        returning * into v_novo;
        situacao        := 'ADICIONADO';
        participante_id := v_novo.id;
        cadastrado_em   := v_novo.criado_em;
        numero          := v_novo.numero;
      exception when unique_violation then
        situacao := 'USUARIO_JA_CADASTRADO';
      end;
    end if;
    return next;
  end loop;
end;
$$;

-- Este navegador já participa? Devolve o @ e o número do sorteio (ou nada).
create or replace function public.minha_participacao(p_dispositivo uuid)
returns table (usuario text, numero integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.instagram_username_normalizado, p.numero
    from public.dispositivos d
    join public.participantes p on p.id = d.participante_id
   where d.dispositivo_id = p_dispositivo;
$$;

-- (Versão antiga, mantida para compatibilidade.) Devolve o @ cadastrado ou null.
create or replace function public.status_dispositivo(p_dispositivo uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.instagram_username_normalizado
    from public.dispositivos d
    join public.participantes p on p.id = d.participante_id
   where d.dispositivo_id = p_dispositivo;
$$;

-- Sorteio (exige a senha). O vencedor é escolhido no servidor com gerador
-- aleatório criptográfico (gen_random_uuid) e fica registrado.
-- Ninguém é removido da lista: pode ser sorteado de novo.
create or replace function public.sortear(p_senha text)
returns public.sorteios
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total    integer;
  v_escolha  public.participantes;
  v_sorteio  public.sorteios;
begin
  if not public.verificar_senha_admin(p_senha) then
    raise exception 'SENHA_INVALIDA' using errcode = '42501';
  end if;

  select count(*) into v_total from public.participantes;
  if v_total = 0 then
    raise exception 'SEM_PARTICIPANTES';
  end if;

  select * into v_escolha
    from public.participantes
   order by gen_random_uuid()
   limit 1;

  insert into public.sorteios (participante_id, instagram_username, total_participantes, numero)
  values (v_escolha.id, v_escolha.instagram_username_normalizado, v_total, v_escolha.numero)
  returning * into v_sorteio;

  return v_sorteio;
end;
$$;

-- Histórico completo (exige a senha). O público vê só os 10 últimos.
create or replace function public.historico_completo(p_senha text)
returns setof public.sorteios
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.verificar_senha_admin(p_senha) then
    raise exception 'SENHA_INVALIDA' using errcode = '42501';
  end if;
  return query select * from public.sorteios order by id desc;
end;
$$;

-- Excluir um participante (exige a senha). O histórico é mantido e o
-- navegador dele fica livre para participar de novo.
create or replace function public.excluir_participante(p_senha text, p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.verificar_senha_admin(p_senha) then
    raise exception 'SENHA_INVALIDA' using errcode = '42501';
  end if;
  delete from public.participantes where id = p_id;
  return found;
end;
$$;

-- Excluir TODOS os participantes de uma vez (exige a senha). Os navegadores
-- ficam livres para participar de novo e os números recomeçam do Nº 1.
-- O histórico de sorteios é mantido (ele tem o botão "Limpar" próprio).
create or replace function public.excluir_todos_participantes(p_senha text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  if not public.verificar_senha_admin(p_senha) then
    raise exception 'SENHA_INVALIDA' using errcode = '42501';
  end if;
  -- Trava o contador: espera cadastros em andamento terminarem e segura os
  -- novos até o fim, para ninguém escapar da limpeza com um número antigo.
  perform 1 from public.contador_numero where id = 1 for update;
  delete from public.participantes where true;   -- apaga também os dispositivos (cascade)
  get diagnostics v_total = row_count;
  update public.contador_numero set ultimo = 0 where id = 1;
  return v_total;
end;
$$;

-- Apagar todo o histórico de sorteios (exige a senha).
create or replace function public.limpar_historico(p_senha text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  if not public.verificar_senha_admin(p_senha) then
    raise exception 'SENHA_INVALIDA' using errcode = '42501';
  end if;
  delete from public.sorteios where true;
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. PERMISSÕES (quem pode chamar o quê pela API)
-- ---------------------------------------------------------------------

revoke all on table public.participantes, public.dispositivos, public.sorteios, public.configuracao_admin,
                    public.contador_numero
  from anon, authenticated;

grant select on table public.participantes to anon, authenticated;
grant select on table public.sorteios      to anon, authenticated;

revoke execute on function public.limpar_instagram(text)               from public, anon, authenticated;
revoke execute on function public.instagram_valido(text)               from public, anon, authenticated;
revoke execute on function public.proximo_numero()                     from public, anon, authenticated;
revoke execute on function public.minha_participacao(uuid)             from public, anon, authenticated;
revoke execute on function public.adicionar_participantes_admin(text, text[]) from public, anon, authenticated;
revoke execute on function public.verificar_senha_admin(text)          from public, anon, authenticated;
revoke execute on function public.ultimos_sorteios_ids()               from public, anon, authenticated;
revoke execute on function public.participar(text, uuid)               from public, anon, authenticated;
revoke execute on function public.status_dispositivo(uuid)             from public, anon, authenticated;
revoke execute on function public.sortear(text)                        from public, anon, authenticated;
revoke execute on function public.historico_completo(text)             from public, anon, authenticated;
revoke execute on function public.excluir_participante(text, bigint)   from public, anon, authenticated;
revoke execute on function public.limpar_historico(text)               from public, anon, authenticated;
revoke execute on function public.excluir_todos_participantes(text)    from public, anon, authenticated;

grant execute on function public.verificar_senha_admin(text)          to anon, authenticated;
grant execute on function public.ultimos_sorteios_ids()               to anon, authenticated;
grant execute on function public.participar(text, uuid)               to anon, authenticated;
grant execute on function public.status_dispositivo(uuid)             to anon, authenticated;
grant execute on function public.minha_participacao(uuid)             to anon, authenticated;
grant execute on function public.adicionar_participantes_admin(text, text[]) to anon, authenticated;
grant execute on function public.sortear(text)                        to anon, authenticated;
grant execute on function public.historico_completo(text)             to anon, authenticated;
grant execute on function public.excluir_participante(text, bigint)   to anon, authenticated;
grant execute on function public.limpar_historico(text)               to anon, authenticated;
grant execute on function public.excluir_todos_participantes(text)    to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. REGRAS DE ACESSO POR LINHA (RLS)
-- ---------------------------------------------------------------------

alter table public.participantes      enable row level security;
alter table public.dispositivos       enable row level security;   -- sem regras = ninguém acessa pela API
alter table public.sorteios           enable row level security;
alter table public.configuracao_admin enable row level security;   -- sem regras = ninguém acessa pela API
alter table public.contador_numero    enable row level security;   -- sem regras = ninguém acessa pela API

drop policy if exists "Todos veem os participantes"    on public.participantes;
drop policy if exists "Público vê os últimos sorteios" on public.sorteios;

create policy "Todos veem os participantes"
  on public.participantes for select
  to anon, authenticated
  using (true);

create policy "Público vê os últimos sorteios"
  on public.sorteios for select
  to anon, authenticated
  using (id in (select public.ultimos_sorteios_ids()));


-- ---------------------------------------------------------------------
-- 5. TEMPO REAL
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participantes') then
    alter publication supabase_realtime add table public.participantes;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sorteios') then
    alter publication supabase_realtime add table public.sorteios;
  end if;
end;
$$;
