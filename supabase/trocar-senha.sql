-- =====================================================================
--  TROCAR A SENHA DO ADMINISTRADOR (botão do cadeado)
--
--  1. Troque NOVA-SENHA-AQUI pela senha desejada.
--  2. Rode no Supabase → SQL Editor.
--  3. NÃO salve este arquivo com a senha real (ele vai para o GitHub).
--
--  A senha é guardada apenas como hash (bcrypt); ninguém consegue lê-la.
--  Obs.: isto vale para o modo real (Supabase). O modo demonstração, que
--  roda sem banco, usa a senha definida em js/demo.js.
-- =====================================================================

update public.configuracao_admin
   set senha_hash = extensions.crypt('NOVA-SENHA-AQUI', extensions.gen_salt('bf', 10))
 where id = 1;
